import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { AppPlatform, BuildFragment, BuildStatus, DistributionType } from '../../graphql/generated';
import { BuildQuery } from '../../graphql/queries/BuildQuery';

export async function getRecentBuildsForSubmissionAsync(
  graphqlClient: ExpoGraphqlClient,
  platform: AppPlatform,
  appId: string,
  { limit = 1 }: { limit?: number } = {}
): Promise<BuildFragment[]> {
  const builds = await BuildQuery.viewBuildsOnAppAsync(graphqlClient, {
    appId,
    limit,
    offset: 0,
    filter: {
      platform,
      distribution: DistributionType.Store,
      status: BuildStatus.InProgress,
    },
  });
  const remainingLimit = limit - builds.length;
  if (remainingLimit > 0) {
    const finishedBuilds = await BuildQuery.viewBuildsOnAppAsync(graphqlClient, {
      appId,
      limit: remainingLimit,
      offset: 0,
      filter: {
        platform,
        distribution: DistributionType.Store,
        status: BuildStatus.Finished,
      },
    });
    builds.push(...finishedBuilds);
  }
  return builds;
}
