import { AppPlatform, BuildFragment, BuildStatus, DistributionType } from '../../graphql/generated';
import { BuildQuery } from '../../graphql/queries/BuildQuery';

export async function getRecentBuildsForSubmissionAsync(
  platform: AppPlatform,
  appId: string,
  { limit = 1 }: { limit?: number } = {}
): Promise<BuildFragment[]> {
  return await BuildQuery.allForAppAsync(appId, {
    limit,
    filter: {
      platform,
      distribution: DistributionType.Store,
      status: BuildStatus.Finished,
    },
  });
}
