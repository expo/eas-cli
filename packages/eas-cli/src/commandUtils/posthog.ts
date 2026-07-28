import chalk from 'chalk';

import { PostHogProjectData } from '../graphql/types/PostHogConnection';
import Log, { link } from '../log';

export function getPostHogProjectDashboardUrl(project: PostHogProjectData): string {
  const host = project.posthogHost.replace(/\/$/, '');
  return `${host}/project/${encodeURIComponent(project.posthogProjectIdentifier)}`;
}

export function formatPostHogProject(project: PostHogProjectData): string {
  return [
    `${chalk.bold('Name')}: ${project.posthogProjectName}`,
    `${chalk.bold('Host')}: ${project.posthogHost}`,
    `${chalk.bold('Region')}: ${project.posthogOrganizationConnection.posthogRegion}`,
    `${chalk.bold('Dashboard')}: ${link(getPostHogProjectDashboardUrl(project), { dim: false })}`,
  ].join('\n');
}

export function logNoPostHogProject(projectName: string): void {
  Log.warn(`No PostHog project is linked to Expo app ${chalk.bold(projectName)} on EAS.`);
}
