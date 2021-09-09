import { AppPlatform, BuildFragment, BuildStatus } from '../../graphql/generated';
import { BuildQuery } from '../../graphql/queries/BuildQuery';

/**
 * Gets build by ID and ensures that `artifacts.buildUrl` exists
 */
export async function getBuildByIdForSubmissionAsync(
  platform: AppPlatform,
  buildId: string
): Promise<BuildFragment> {
  const build = await BuildQuery.byIdAsync(buildId);

  if (build.platform !== platform) {
    throw new Error("Build platform doesn't match!");
  }

  return build;
}

export async function getLatestBuildForSubmissionAsync(
  platform: AppPlatform,
  appId: string
): Promise<BuildFragment | null> {
  const [build] = await BuildQuery.allForAppAsync(appId, {
    limit: 1,
    filter: {
      platform,
      status: BuildStatus.Finished,
    },
  });
  return build;
}
