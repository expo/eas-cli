import assert from 'assert';

import { getExpoApiBaseUrl, getExpoWebsiteBaseUrl } from '../../api';
import { AppPlatform, BuildFragment } from '../../graphql/generated';

export function getProjectDashboardUrl(accountName: string, projectName: string): string {
  return getProjectPageUrl(accountName, projectName);
}

export function getProjectPageUrl(
  accountName: string,
  projectName: string,
  page?: string | null
): string {
  const projectPath = `/accounts/${encodeURIComponent(accountName)}/projects/${encodeURIComponent(
    projectName
  )}`;
  return new URL(page ? `${projectPath}/${page}` : projectPath, getExpoWebsiteBaseUrl()).toString();
}

export function getBuildLogsUrl(build: BuildFragment, hash?: string): string {
  const { app } = build;
  const url = `/accounts/${app.ownerAccount.name}/projects/${app.slug}/builds/${build.id}${
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
      build.app.id
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

export function getDeviceRunSessionUrl(
  accountName: string,
  projectName: string,
  deviceRunSessionId: string
): string {
  return new URL(
    `/accounts/${encodeURIComponent(accountName)}/projects/${encodeURIComponent(
      projectName
    )}/simulator-sessions/${encodeURIComponent(deviceRunSessionId)}`,
    getExpoWebsiteBaseUrl()
  ).toString();
}

/**
 * @deprecated Links to the raw job-run page; prefer a higher-level URL (e.g. the workflow run
 * or the feature-specific dashboard) that gives users more context. Use this only for internal
 * tooling where no richer URL exists.
 */
export function getBareJobRunUrl(
  accountName: string,
  projectName: string,
  jobRunId: string
): string {
  return new URL(
    `/accounts/${encodeURIComponent(accountName)}/projects/${encodeURIComponent(
      projectName
    )}/job-runs/${encodeURIComponent(jobRunId)}`,
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

export function getHostingDeploymentsUrl(accountName: string, projectName: string): string {
  return new URL(
    `/accounts/${encodeURIComponent(accountName)}/projects/${encodeURIComponent(
      projectName
    )}/hosting/deployments`,
    getExpoWebsiteBaseUrl()
  ).toString();
}
