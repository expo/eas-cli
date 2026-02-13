import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { EasCommandError } from '../commandUtils/errors';
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

const METRIC_ALIASES: Record<string, string> = {
  tti: 'expo.app_startup.tti',
  ttr: 'expo.app_startup.ttr',
  cold_launch: 'expo.app_startup.cold_launch_time',
  warm_launch: 'expo.app_startup.warm_launch_time',
  bundle_load: 'expo.app_startup.bundle_load_time',
};

const KNOWN_FULL_NAMES = new Set(Object.values(METRIC_ALIASES));

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

export function resolveMetricName(input: string): string {
  if (METRIC_ALIASES[input]) {
    return METRIC_ALIASES[input];
  }
  if (KNOWN_FULL_NAMES.has(input) || input.includes('.')) {
    return input;
  }
  throw new EasCommandError(
    `Unknown metric: "${input}". Use a full metric name (e.g. expo.app_startup.tti) or a short alias: ${Object.keys(METRIC_ALIASES).join(', ')}`
  );
}

interface FetchObserveEventsOptions {
  metricName: string;
  orderBy: AppObserveEventsOrderBy;
  limit: number;
  startTime: string;
  endTime: string;
  platform?: AppObservePlatform;
  appVersion?: string;
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
  };

  return ObserveQuery.eventsAsync(graphqlClient, {
    appId,
    filter,
    first: options.limit,
    orderBy: options.orderBy,
  });
}
