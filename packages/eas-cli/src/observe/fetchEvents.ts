import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import {
  AppObserveMetric,
  AppObserveMetricsListFilter,
  AppObserveMetricsListOrderBy,
  AppObserveMetricsListOrderByField,
  AppObserveOrderDirection,
  AppObservePlatform,
  PageInfo,
} from '../graphql/generated';
import { ObserveQuery } from '../graphql/queries/ObserveQuery';
import { isObservePlanGateError } from './planGating';
import { ObservePlatformTarget } from './platforms';

export enum EventsOrderPreset {
  Slowest = 'SLOWEST',
  Fastest = 'FASTEST',
  Newest = 'NEWEST',
  Oldest = 'OLDEST',
}

export function resolveOrderBy(input: string): AppObserveMetricsListOrderBy {
  const preset = input.toUpperCase() as EventsOrderPreset;
  switch (preset) {
    case EventsOrderPreset.Slowest:
      return {
        field: AppObserveMetricsListOrderByField.Value,
        direction: AppObserveOrderDirection.Desc,
      };
    case EventsOrderPreset.Fastest:
      return {
        field: AppObserveMetricsListOrderByField.Value,
        direction: AppObserveOrderDirection.Asc,
      };
    case EventsOrderPreset.Newest:
      return {
        field: AppObserveMetricsListOrderByField.Timestamp,
        direction: AppObserveOrderDirection.Desc,
      };
    case EventsOrderPreset.Oldest:
      return {
        field: AppObserveMetricsListOrderByField.Timestamp,
        direction: AppObserveOrderDirection.Asc,
      };
  }
}

interface FetchObserveEventsOptions {
  metricName?: string;
  orderBy: AppObserveMetricsListOrderBy;
  limit: number;
  after?: string;
  startTime?: string;
  endTime?: string;
  platforms?: AppObservePlatform[];
  appVersion?: string;
  buildNumber?: string;
  updateId?: string;
  sessionId?: string;
  environment?: string;
}

interface FetchObserveEventsResult {
  events: AppObserveMetric[];
  pageInfo: PageInfo;
}

export async function fetchObserveEventsAsync(
  graphqlClient: ExpoGraphqlClient,
  appId: string,
  options: FetchObserveEventsOptions
): Promise<FetchObserveEventsResult> {
  const filter: AppObserveMetricsListFilter = {
    ...(options.startTime && { startTime: options.startTime }),
    ...(options.endTime && { endTime: options.endTime }),
    ...(options.metricName && { name: options.metricName }),
    ...(options.platforms?.length && { platforms: options.platforms }),
    ...(options.appVersion && { appVersion: options.appVersion }),
    ...(options.buildNumber && { appBuildNumber: options.buildNumber }),
    ...(options.updateId && { appUpdateId: options.updateId }),
    ...(options.sessionId && { sessionId: options.sessionId }),
    ...(options.environment && { environment: options.environment }),
  };

  return await ObserveQuery.eventsAsync(graphqlClient, {
    appId,
    filter,
    first: options.limit,
    ...(options.after && { after: options.after }),
    orderBy: options.orderBy,
  });
}

export async function fetchTotalEventCountAsync(
  graphqlClient: ExpoGraphqlClient,
  appId: string,
  metricName: string,
  targets: ObservePlatformTarget[],
  startTime: string,
  endTime: string,
  environment?: string
): Promise<number> {
  const queries = targets.map(async target => {
    try {
      const versions = await ObserveQuery.appVersionsAsync(graphqlClient, {
        appId,
        platforms: target.platforms,
        startTime,
        endTime,
        metricNames: [metricName],
        environment,
      });
      return versions.reduce((sum, v) => {
        const metric = v.metrics.find(m => m.metricName === metricName);
        return sum + (metric?.eventCount ?? 0);
      }, 0);
    } catch (error) {
      // A plan gate is an account-wide rejection, not a per-platform failure —
      // let it propagate so the command surfaces the upgrade prompt.
      if (isObservePlanGateError(error)) {
        throw error;
      }
      return 0;
    }
  });

  const counts = await Promise.all(queries);
  return counts.reduce((a, b) => a + b, 0);
}
