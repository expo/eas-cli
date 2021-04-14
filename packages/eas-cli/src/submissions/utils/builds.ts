import { AppPlatform, BuildStatus } from '../../graphql/generated';
import { BuildQuery } from '../../graphql/queries/BuildQuery';

export async function getBuildArtifactUrlByIdAsync(
  platform: AppPlatform,
  buildId: string
): Promise<string> {
  const { platform: buildPlatform, artifacts } = await BuildQuery.byIdAsync(buildId);

  if (buildPlatform !== platform) {
    throw new Error("Build platform doesn't match!");
  }

  if (!artifacts) {
    throw new Error('Build has no artifacts.');
  }
  const buildUrl = artifacts.buildUrl;
  if (!buildUrl) {
    throw new Error('Build URL is not defined.');
  }
  return buildUrl;
}

export async function getLatestBuildArtifactUrlAsync(
  platform: AppPlatform,
  appId: string
): Promise<string | null> {
  const builds = await BuildQuery.allForAppAsync(appId, {
    platform,
    status: BuildStatus.Finished,
    limit: 1,
  });

  if (builds.length < 1) {
    return null;
  }

  const { artifacts } = builds[0];
  if (!artifacts) {
    return null;
  }

  return artifacts.buildUrl ?? null;
}
