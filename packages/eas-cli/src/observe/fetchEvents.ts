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
import { isObservePlanGateError } from './planGating';
import { ObservePlatformTarget } from './platforms';

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
  metricName?: string;
  orderBy: AppObserveEventsOrderBy;
  limit: number;
  after?: string;
  startTime?: string;
  endTime?: string;
  platforms?: AppObservePlatform[];
  appVersion?: string;
  updateId?: string;
  sessionId?: string;
  environment?: string;
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
    ...(options.startTime && { startTime: options.startTime }),
    ...(options.endTime && { endTime: options.endTime }),
    ...(options.metricName && { metricName: options.metricName }),
    ...(options.platforms?.length && { platforms: options.platforms }),
    ...(options.appVersion && { appVersion: options.appVersion }),
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
