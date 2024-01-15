import chalk from 'chalk';

import { Build, BuildFragment, BuildStatus } from '../graphql/generated';
import { BuildQuery } from '../graphql/queries/BuildQuery';
import { appPlatformEmojis } from '../platform';
import { ExpoGraphqlClient } from './context/contextUtils/createGraphqlClient';

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
  statuses,
}: {
  graphqlClient: ExpoGraphqlClient;
  projectId: string;
  statuses?: BuildStatus[];
}): Promise<BuildFragment[]> {
  let builds = [];
  if (!statuses) {
    builds = await BuildQuery.viewBuildsOnAppAsync(graphqlClient, {
      appId: projectId,
      offset: 0,
      limit: 10,
    });
  } else {
    for (const status of statuses) {
      const buildsForStatus = await BuildQuery.viewBuildsOnAppAsync(graphqlClient, {
        appId: projectId,
        offset: 0,
        limit: 10,
        filter: { status },
      });
      builds.push(...buildsForStatus);
    }
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
