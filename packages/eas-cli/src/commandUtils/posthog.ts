import { PostHogProjectData } from '../graphql/types/PostHogConnection';

export function getPostHogProjectDashboardUrl(project: PostHogProjectData): string {
  const host = project.posthogHost.replace(/\/$/, '');
  return `${host}/project/${encodeURIComponent(project.posthogProjectIdentifier)}`;
}
