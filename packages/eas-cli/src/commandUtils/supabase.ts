import { CombinedError } from '@urql/core';
import chalk from 'chalk';

import {
  SupabaseAdvisorLintData,
  SupabaseAdvisorLintLevel,
  SupabaseAdvisorType,
  SupabaseConnectionData,
  SupabaseOrganizationData,
  SupabaseProjectData,
} from '../graphql/types/SupabaseConnection';
import Log, { link } from '../log';

export const SUPABASE_REAUTHORIZATION_REQUIRED_ERROR_CODE =
  'SUPABASE_REAUTHORIZATION_REQUIRED_ERROR';

export function getSupabaseProjectDashboardUrl(
  project: Pick<SupabaseProjectData, 'supabaseProjectRef'>
): string {
  return `https://supabase.com/dashboard/project/${encodeURIComponent(project.supabaseProjectRef)}`;
}

function extractProjectRefFromUrl(value: string): string | null {
  if (!/^https?:\/\//i.test(value)) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const projectHost = url.hostname.match(/^([a-z0-9]+)\.supabase\./i);
  if (projectHost) {
    return projectHost[1];
  }
  const dashboardPath = url.pathname.match(/\/dashboard\/project\/([^/]+)/);
  if (dashboardPath) {
    return decodeURIComponent(dashboardPath[1]);
  }
  return null;
}

/**
 * Accepts whatever a user is likely to have on hand: the bare reference ID, the dashboard URL, or
 * the project API URL. Supabase labels the ref "Reference ID" under Project Settings → General.
 */
export function parseSupabaseProjectRef(input: string): string {
  const value = input.trim();
  if (!value) {
    throw new Error(
      'No Supabase project given. Pass the project reference ID or its dashboard URL, for example --link jfurmbuioogljwsqwnpd.'
    );
  }
  const ref = extractProjectRefFromUrl(value) ?? value;
  if (!/^[a-z0-9]+$/i.test(ref)) {
    throw new Error(
      `"${input}" is not a Supabase project reference ID. Supabase shows it as "Reference ID" under Project Settings → General; you can also paste the dashboard URL (https://supabase.com/dashboard/project/<ref>). Note that a project name is not a reference ID.`
    );
  }
  // Refs are lowercase, and the server matches them exactly.
  return ref.toLowerCase();
}

/** Prefer human-readable org name; Supabase slugs are often opaque ids like `ycjmzsygzfkryaazoitp`. */
export function formatSupabaseOrganization(
  connection: Pick<SupabaseConnectionData, 'supabaseOrganizationSlug' | 'supabaseOrganizationName'>,
  organizations: readonly SupabaseOrganizationData[] = []
): string {
  const slug = connection.supabaseOrganizationSlug;
  const storedName = connection.supabaseOrganizationName;
  const liveName = organizations.find(organization => organization.slug === slug)?.name;
  const name = storedName || liveName;
  if (name && name !== slug) {
    return `${name} (${slug})`;
  }
  return slug;
}

/** Prefer human-readable project name over the opaque project ref. */
export function formatSupabaseProjectLabel(
  project: Pick<SupabaseProjectData, 'supabaseProjectRef' | 'supabaseProjectName'>
): string {
  const { supabaseProjectRef: ref, supabaseProjectName: name } = project;
  if (name && name !== ref) {
    return `${name} (${ref})`;
  }
  return ref;
}

export function formatSupabaseProject(project: SupabaseProjectData): string {
  return [
    `${chalk.bold('Name')}: ${project.supabaseProjectName}`,
    `${chalk.bold('Ref')}: ${project.supabaseProjectRef}`,
    `${chalk.bold('URL')}: ${project.supabaseProjectUrl}`,
    `${chalk.bold('Region')}: ${project.supabaseRegion}`,
    `${chalk.bold('Dashboard')}: ${link(getSupabaseProjectDashboardUrl(project), { dim: false })}`,
  ].join('\n');
}

export function logNoSupabaseProject(projectName: string): void {
  Log.warn(`No Supabase project is linked to Expo app ${chalk.bold(projectName)} on EAS.`);
}

export function getSupabaseAdvisorsDashboardUrl(
  project: Pick<SupabaseProjectData, 'supabaseProjectRef'>,
  type: SupabaseAdvisorType
): string {
  return `${getSupabaseProjectDashboardUrl(project)}/advisors/${type.toLowerCase()}`;
}

export function isSupabaseReauthorizationRequiredError(error: unknown): boolean {
  return (
    error instanceof CombinedError &&
    error.graphQLErrors.some(
      graphQLError =>
        graphQLError.extensions?.errorCode === SUPABASE_REAUTHORIZATION_REQUIRED_ERROR_CODE
    )
  );
}

const ADVISOR_LINT_LEVEL_LABELS: Record<
  SupabaseAdvisorLintLevel,
  [singular: string, plural: string]
> = {
  ERROR: ['error', 'errors'],
  WARN: ['warning', 'warnings'],
  INFO: ['suggestion', 'suggestions'],
};

const ADVISOR_LINT_LEVEL_MARKERS: Record<SupabaseAdvisorLintLevel, string> = {
  [SupabaseAdvisorLintLevel.Error]: chalk.red('✖'),
  [SupabaseAdvisorLintLevel.Warn]: chalk.yellow('▲'),
  [SupabaseAdvisorLintLevel.Info]: chalk.blue('●'),
};

export function summarizeSupabaseAdvisorLints(lints: readonly SupabaseAdvisorLintData[]): string {
  if (lints.length === 0) {
    return 'no unresolved findings';
  }
  return (Object.keys(ADVISOR_LINT_LEVEL_LABELS) as SupabaseAdvisorLintLevel[])
    .map(level => [level, lints.filter(lint => lint.level === level).length] as const)
    .filter(([, count]) => count > 0)
    .map(([level, count]) => `${count} ${ADVISOR_LINT_LEVEL_LABELS[level][count === 1 ? 0 : 1]}`)
    .join(', ');
}

function stripInlineCode(text: string): string {
  return text.replaceAll('\\`', '').replaceAll('`', '');
}

export function formatSupabaseAdvisorLints(
  project: Pick<SupabaseProjectData, 'supabaseProjectRef'>,
  type: SupabaseAdvisorType,
  lints: readonly SupabaseAdvisorLintData[]
): string {
  const heading = `${chalk.bold(type === SupabaseAdvisorType.Security ? 'Security' : 'Performance')}: ${summarizeSupabaseAdvisorLints(lints)}`;
  const rows = lints.flatMap(lint => [
    `  ${ADVISOR_LINT_LEVEL_MARKERS[lint.level]} ${chalk.bold(lint.title)}${lint.entity ? `  ${chalk.dim(lint.entity)}` : ''}`,
    `      ${stripInlineCode(lint.detail)}`,
    ...(lint.remediation
      ? [`      ${chalk.dim('Fix:')} ${link(lint.remediation, { dim: false })}`]
      : []),
  ]);
  const dashboard = `  ${chalk.dim('Dashboard:')} ${link(getSupabaseAdvisorsDashboardUrl(project, type), { dim: false })}`;
  return [heading, ...rows, dashboard].join('\n');
}
