import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { AppPlatform, BuildFragment, BuildStatus, DistributionType } from '../../graphql/generated';
import { BuildQuery } from '../../graphql/queries/BuildQuery';

export async function getRecentBuildsForSubmissionAsync(
  graphqlClient: ExpoGraphqlClient,
  platform: AppPlatform,
  appId: string,
  { limit = 1 }: { limit?: number } = {}
): Promise<BuildFragment[]> {
  const allowedStatuses = [
    BuildStatus.New,
    BuildStatus.InQueue,
    BuildStatus.InProgress,
    BuildStatus.Finished,
  ];
  const buildsPromises: Promise<BuildFragment[]>[] = [];
  for (const buildStatus of allowedStatuses) {
    buildsPromises.push(
      BuildQuery.viewBuildsOnAppAsync(graphqlClient, {
        appId,
        limit,
        offset: 0,
        filter: {
          platform,
          distribution: DistributionType.Store,
          status: buildStatus,
        },
      })
    );
  }
  const builds = (await Promise.all(buildsPromises)).reduce((acc, value) => acc.concat(value), []);
  builds.sort((buildA, buildB) => (buildA.createdAt > buildB.createdAt ? -1 : 1));

  return builds.slice(0, limit);
}
