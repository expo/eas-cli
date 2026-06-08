import chalk from 'chalk';

import { PostHogProjectData } from '../graphql/types/PostHogConnection';
import Log from '../log';

export function getPostHogProjectDashboardUrl(project: PostHogProjectData): string {
  const host = project.posthogHost.replace(/\/$/, '');
  return `${host}/project/${encodeURIComponent(project.posthogProjectIdentifier)}`;
}

export function logNoPostHogProject(projectName: string): void {
  Log.warn(`No PostHog project is linked to Expo app ${chalk.bold(projectName)} on EAS.`);
}
