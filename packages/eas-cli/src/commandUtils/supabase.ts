import chalk from 'chalk';

import {
  SupabaseConnectionData,
  SupabaseOrganizationData,
  SupabaseProjectData,
} from '../graphql/types/SupabaseConnection';
import Log, { link } from '../log';

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
  return ref;
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
