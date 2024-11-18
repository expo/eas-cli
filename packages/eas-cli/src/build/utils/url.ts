import assert from 'assert';

import { getExpoApiBaseUrl, getExpoWebsiteBaseUrl } from '../../api';
import { AppPlatform, BuildFragment } from '../../graphql/generated';

export function getProjectDashboardUrl(accountName: string, projectName: string): string {
  return new URL(
    `/accounts/${accountName}/projects/${projectName}`,
    getExpoWebsiteBaseUrl()
  ).toString();
}

export function getBuildLogsUrl(build: BuildFragment, hash?: string): string {
  const { project } = build;
  const url =
    project.__typename !== 'App'
      ? `/builds/${build.id}`
      : `/accounts/${project.ownerAccount.name}/projects/${project.slug}/builds/${build.id}${
          hash ? `#${hash}` : ''
        }`;

  return new URL(url, getExpoWebsiteBaseUrl()).toString();
}

export function getArtifactUrl(artifactId: string): string {
  return new URL(`/artifacts/${artifactId}`, getExpoWebsiteBaseUrl()).toString();
}

export function getInternalDistributionInstallUrl(build: BuildFragment): string {
  if (build.platform === AppPlatform.Ios) {
    return `itms-services://?action=download-manifest;url=${getExpoApiBaseUrl()}/v2/projects/${
      build.project.id
    }/builds/${build.id}/manifest.plist`;
  }

  assert(build.artifacts?.buildUrl, 'buildUrl is missing');

  return build.artifacts.buildUrl;
}

export function getUpdateGroupUrl(
  accountName: string,
  projectName: string,
  updateGroupId: string
): string {
  return new URL(
    `/accounts/${encodeURIComponent(accountName)}/projects/${encodeURIComponent(
      projectName
    )}/updates/${encodeURIComponent(updateGroupId)}`,
    getExpoWebsiteBaseUrl()
  ).toString();
}

export function getWorkflowRunUrl(
  accountName: string,
  projectName: string,
  workflowRunId: string
): string {
  return new URL(
    `/accounts/${encodeURIComponent(accountName)}/projects/${encodeURIComponent(
      projectName
    )}/workflows/${workflowRunId}`,
    getExpoWebsiteBaseUrl()
  ).toString();
}

export function getProjectGitHubSettingsUrl(accountName: string, projectName: string): string {
  return new URL(
    `/accounts/${encodeURIComponent(accountName)}/projects/${encodeURIComponent(
      projectName
    )}/github`,
    getExpoWebsiteBaseUrl()
  ).toString();
}
