import assert from 'assert';

import { getExpoApiV2Url, getExpoWebsiteBaseUrl } from '../../api';
import { AppPlatform, BuildFragment } from '../../graphql/generated';

export function getProjectDashboardUrl(accountName: string, projectName: string): string {
  return `${getExpoWebsiteBaseUrl()}/accounts/${accountName}/projects/${projectName}`;
}

export function getBuildLogsUrl(build: BuildFragment): string {
  const { project } = build;
  if (project.__typename === 'App') {
    return `${getExpoWebsiteBaseUrl()}/accounts/${project.ownerAccount.name}/builds/${build.id}`;
  } else {
    return `${getExpoWebsiteBaseUrl()}/builds/${build.id}`;
  }
}

export function getArtifactUrl(artifactId: string): string {
  return `${getExpoWebsiteBaseUrl()}/artifacts/${artifactId}`;
}

export function getInternalDistributionInstallUrl(build: BuildFragment): string {
  if (build.platform === AppPlatform.Ios) {
    return `itms-services://?action=download-manifest;url=${getExpoApiV2Url()}/projects/${
      build.project.id
    }/builds/${build.id}/manifest.plist`;
  }

  assert(build.artifacts?.buildUrl, 'buildUrl is missing');

  return build.artifacts.buildUrl;
}
