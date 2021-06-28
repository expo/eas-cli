import assert from 'assert';

import { getExpoApiBaseUrl, getExpoWebsiteBaseUrl } from '../../api';
import { AppPlatform, BuildFragment } from '../../graphql/generated';

export function getBuildLogsUrl({
  buildId,
  account,
}: {
  buildId: string;
  account: string;
}): string {
  return `${getExpoWebsiteBaseUrl()}/accounts/${account}/builds/${buildId}`;
}

export function getArtifactUrl(artifactId: string): string {
  return `${getExpoWebsiteBaseUrl()}/artifacts/${artifactId}`;
}

export function getInternalDistributionInstallUrl(build: BuildFragment): string {
  if (build.platform === AppPlatform.Ios) {
    return `itms-services://?action=download-manifest;url=${getExpoApiBaseUrl()}/--/api/v2/projects/${
      build.project.id
    }/builds/${build.id}/manifest.plist`;
  }

  const buildUrl = build.artifacts?.shortBuildUrl ?? build.artifacts?.buildUrl;
  assert(buildUrl, 'buildUrl is missing');

  return buildUrl;
}
