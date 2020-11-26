import { AppPlatform, BuildStatus } from '../../graphql/generated';
import { BuildQuery } from '../../graphql/queries/BuildQuery';
import { SubmissionPlatform } from '../types';

const graphqlPlatform: Record<SubmissionPlatform, AppPlatform> = {
  [SubmissionPlatform.Android]: AppPlatform.Android,
  [SubmissionPlatform.iOS]: AppPlatform.Ios,
};

export async function getBuildArtifactUrlByIdAsync(
  platform: SubmissionPlatform,
  buildId: string
): Promise<string> {
  const { platform: buildPlatform, artifacts } = await BuildQuery.byIdAsync(buildId);

  if (buildPlatform !== graphqlPlatform[platform]) {
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
  platform: SubmissionPlatform,
  appId: string
): Promise<string | null> {
  const builds = await BuildQuery.allForAppAsync(appId, {
    platform: graphqlPlatform[platform],
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
