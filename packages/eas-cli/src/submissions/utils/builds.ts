import { AppPlatform, BuildStatus } from '../../graphql/generated';
import { BuildQuery } from '../../graphql/queries/BuildQuery';

export interface SubmittedBuildInfo {
  buildId: string;
  artifactUrl: string;
}

export async function getBuildInfoByIdAsync(
  platform: AppPlatform,
  buildId: string
): Promise<SubmittedBuildInfo> {
  const { platform: buildPlatform, artifacts } = await BuildQuery.byIdAsync(buildId);

  if (buildPlatform !== platform) {
    throw new Error("Build platform doesn't match!");
  }

  if (!artifacts) {
    throw new Error('Build has no artifacts.');
  }
  const artifactUrl = artifacts.buildUrl;
  if (!artifactUrl) {
    throw new Error('Build URL is not defined.');
  }
  return { buildId, artifactUrl };
}

export async function getLatestBuildInfoAsync(
  platform: AppPlatform,
  appId: string
): Promise<SubmittedBuildInfo | null> {
  const builds = await BuildQuery.allForAppAsync(appId, {
    platform,
    status: BuildStatus.Finished,
    limit: 1,
  });

  if (builds.length < 1) {
    return null;
  }

  const { id, artifacts } = builds[0];
  if (!artifacts || !artifacts.buildUrl) {
    return null;
  }

  return { buildId: id, artifactUrl: artifacts.buildUrl };
}
