import { AppPlatform, BuildFragment, BuildStatus } from '../../graphql/generated';
import { BuildQuery } from '../../graphql/queries/BuildQuery';

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
