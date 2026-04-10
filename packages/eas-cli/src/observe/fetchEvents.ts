import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import {
  AppObserveEvent,
  AppObserveEventsFilter,
  AppObserveEventsOrderBy,
  AppObserveEventsOrderByDirection,
  AppObserveEventsOrderByField,
  AppObservePlatform,
  AppPlatform,
  PageInfo,
} from '../graphql/generated';
import { ObserveQuery } from '../graphql/queries/ObserveQuery';

export enum EventsOrderPreset {
  Slowest = 'SLOWEST',
  Fastest = 'FASTEST',
  Newest = 'NEWEST',
  Oldest = 'OLDEST',
}

export function resolveOrderBy(input: string): AppObserveEventsOrderBy {
  const preset = input.toUpperCase() as EventsOrderPreset;
  switch (preset) {
    case EventsOrderPreset.Slowest:
      return {
        field: AppObserveEventsOrderByField.MetricValue,
        direction: AppObserveEventsOrderByDirection.Desc,
      };
    case EventsOrderPreset.Fastest:
      return {
        field: AppObserveEventsOrderByField.MetricValue,
        direction: AppObserveEventsOrderByDirection.Asc,
      };
    case EventsOrderPreset.Newest:
      return {
        field: AppObserveEventsOrderByField.Timestamp,
        direction: AppObserveEventsOrderByDirection.Desc,
      };
    case EventsOrderPreset.Oldest:
      return {
        field: AppObserveEventsOrderByField.Timestamp,
        direction: AppObserveEventsOrderByDirection.Asc,
      };
  }
}

interface FetchObserveEventsOptions {
  metricName: string;
  orderBy: AppObserveEventsOrderBy;
  limit: number;
  after?: string;
  startTime: string;
  endTime: string;
  platform?: AppObservePlatform;
  appVersion?: string;
  updateId?: string;
}

interface FetchObserveEventsResult {
  events: AppObserveEvent[];
  pageInfo: PageInfo;
}

export async function fetchObserveEventsAsync(
  graphqlClient: ExpoGraphqlClient,
  appId: string,
  options: FetchObserveEventsOptions
): Promise<FetchObserveEventsResult> {
  const filter: AppObserveEventsFilter = {
    metricName: options.metricName,
    startTime: options.startTime,
    endTime: options.endTime,
    ...(options.platform && { platform: options.platform }),
    ...(options.appVersion && { appVersion: options.appVersion }),
    ...(options.updateId && { appUpdateId: options.updateId }),
  };

  return await ObserveQuery.eventsAsync(graphqlClient, {
    appId,
    filter,
    first: options.limit,
    ...(options.after && { after: options.after }),
    orderBy: options.orderBy,
  });
}

const appPlatformToObservePlatform: Record<AppPlatform, AppObservePlatform> = {
  [AppPlatform.Android]: AppObservePlatform.Android,
  [AppPlatform.Ios]: AppObservePlatform.Ios,
};

export async function fetchTotalEventCountAsync(
  graphqlClient: ExpoGraphqlClient,
  appId: string,
  metricName: string,
  platforms: AppPlatform[],
  startTime: string,
  endTime: string
): Promise<number> {
  const queries = platforms.map(async appPlatform => {
    try {
      const versions = await ObserveQuery.appVersionsAsync(graphqlClient, {
        appId,
        platform: appPlatformToObservePlatform[appPlatform],
        startTime,
        endTime,
        metricNames: [metricName],
      });
      return versions.reduce((sum, v) => {
        const metric = v.metrics.find(m => m.metricName === metricName);
        return sum + (metric?.eventCount ?? 0);
      }, 0);
    } catch {
      return 0;
    }
  });

  const counts = await Promise.all(queries);
  return counts.reduce((a, b) => a + b, 0);
}
