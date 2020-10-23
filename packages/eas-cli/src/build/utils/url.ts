import { getExpoWebsiteBaseUrl } from '../../api';

export function getBuildLogsUrl({
  buildId,
  account,
}: {
  buildId: string;
  account: string;
}): string {
  return `${getExpoWebsiteBaseUrl()}/accounts/${account}/builds/v2/${buildId}`;
}

export function getArtifactUrl(artifactId: string): string {
  return `${getExpoWebsiteBaseUrl()}/artifacts/${artifactId}`;
}
