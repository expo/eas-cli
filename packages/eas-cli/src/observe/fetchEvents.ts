import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import {
  AppObserveEvent,
  AppObserveEventsFilter,
  AppObserveEventsOrderBy,
  AppObserveEventsOrderByDirection,
  AppObserveEventsOrderByField,
  AppObservePlatform,
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
