import {
  AppPlatform,
  BuildFragment,
  BuildStatus,
  DistributionType,
} from '../../graphql/generated.js';
import { BuildQuery } from '../../graphql/queries/BuildQuery.js';

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
