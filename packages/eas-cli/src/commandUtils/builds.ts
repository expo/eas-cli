import chalk from 'chalk';

import { ExpoGraphqlClient } from './context/contextUtils/createGraphqlClient';
import {
  AppPlatform,
  Build,
  BuildFilter,
  BuildFragment,
  BuildStatus,
  InputMaybe,
} from '../graphql/generated';
import { BuildQuery } from '../graphql/queries/BuildQuery';
import { RequestedPlatform, appPlatformEmojis } from '../platform';

const platformToAppPlatform: Record<
  Exclude<RequestedPlatform, RequestedPlatform.All>,
  AppPlatform
> = {
  android: AppPlatform.Android,
  ios: AppPlatform.Ios,
};

export async function ensureBuildExistsAsync(
  graphqlClient: ExpoGraphqlClient,
  buildId: string
): Promise<void> {
  try {
    await BuildQuery.byIdAsync(graphqlClient, buildId);
  } catch {
    throw new Error(`Couldn't find a build matching the id ${buildId}`);
  }
}

export async function fetchBuildsAsync({
  graphqlClient,
  projectId,
  filters,
}: {
  graphqlClient: ExpoGraphqlClient;
  projectId: string;
  filters?: {
    statuses?: BuildStatus[];
    platform?: RequestedPlatform;
    profile?: string;
    hasFingerprint?: boolean;
  };
}): Promise<BuildFragment[]> {
  let builds: BuildFragment[];
  const queryFilters: InputMaybe<BuildFilter> = {};
  if (filters?.platform && filters.platform !== 'all') {
    queryFilters['platform'] = platformToAppPlatform[filters.platform];
  }
  if (filters?.profile) {
    queryFilters['buildProfile'] = filters.profile;
  }
  if (filters?.hasFingerprint) {
    queryFilters['hasFingerprint'] = filters.hasFingerprint;
  }
  if (!filters?.statuses) {
    builds = await BuildQuery.viewBuildsOnAppAsync(graphqlClient, {
      appId: projectId,
      offset: 0,
      limit: 10,
      filter: queryFilters ? queryFilters : undefined,
    });
  } else {
    builds = (
      await Promise.all(
        filters.statuses.map(status =>
          BuildQuery.viewBuildsOnAppAsync(graphqlClient, {
            appId: projectId,
            offset: 0,
            limit: 10,
            filter: queryFilters ? { ...queryFilters, status } : { status },
          })
        )
      )
    ).flat();
  }
  builds.sort((buildA, buildB) => (buildA.createdAt > buildB.createdAt ? -1 : 1));
  return builds;
}

export function formatBuild(
  build: Pick<Build, 'id' | 'platform' | 'status' | 'createdAt'>
): string {
  const platform = appPlatformEmojis[build.platform];
  const startTime = new Date(build.createdAt).toLocaleString();
  let statusText: string;
  if (build.status === BuildStatus.New) {
    statusText = 'new';
  } else if (build.status === BuildStatus.InQueue) {
    statusText = 'in queue';
  } else if (build.status === BuildStatus.InProgress) {
    statusText = 'in progress';
  } else if (build.status === BuildStatus.Finished) {
    statusText = 'finished';
  } else if (build.status === BuildStatus.Errored) {
    statusText = 'errored';
  } else if ([BuildStatus.PendingCancel, BuildStatus.Canceled].includes(build.status)) {
    statusText = 'canceled';
  } else {
    statusText = 'unknown';
  }
  const status = chalk.blue(statusText);
  return `${platform} Started at: ${startTime}, Status: ${status}, Id: ${build.id}`;
}
