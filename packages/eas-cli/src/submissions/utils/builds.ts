import { BuildQuery } from '../../graphql/queries/BuildQuery';
import { BuildPlatform, BuildStatus } from '../../graphql/types/Build';
import { SubmissionPlatform } from '../types';

const graphqlPlatform: Record<SubmissionPlatform, BuildPlatform> = {
  [SubmissionPlatform.Android]: BuildPlatform.Android,
  [SubmissionPlatform.iOS]: BuildPlatform.iOS,
};

export async function getBuildArtifactUrlByIdAsync(
  platform: SubmissionPlatform,
  buildId: string
): Promise<string> {
  const {
    platform: buildPlatform,
    artifacts: { buildUrl },
  } = await BuildQuery.byIdAsync(buildId);

  if (buildPlatform !== graphqlPlatform[platform]) {
    throw new Error("Build platform doesn't match!");
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

  return builds[0].artifacts.buildUrl;
}
