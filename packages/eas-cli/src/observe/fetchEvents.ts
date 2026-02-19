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

export type EventsOrderPreset = 'slowest' | 'fastest' | 'newest' | 'oldest';

export const DEFAULT_EVENTS_LIMIT = 10;

export function resolveOrderBy(preset: EventsOrderPreset): AppObserveEventsOrderBy {
  switch (preset) {
    case 'slowest':
      return {
        field: AppObserveEventsOrderByField.MetricValue,
        direction: AppObserveEventsOrderByDirection.Desc,
      };
    case 'fastest':
      return {
        field: AppObserveEventsOrderByField.MetricValue,
        direction: AppObserveEventsOrderByDirection.Asc,
      };
    case 'newest':
      return {
        field: AppObserveEventsOrderByField.Timestamp,
        direction: AppObserveEventsOrderByDirection.Desc,
      };
    case 'oldest':
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

  return ObserveQuery.eventsAsync(graphqlClient, {
    appId,
    filter,
    first: options.limit,
    orderBy: options.orderBy,
  });
}
