import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import {
  AppObservePlatform,
  AppObserveUserEvent,
  AppObserveUserEventListFilter,
  AppObserveUserEventListOrderBy,
  PageInfo,
} from '../graphql/generated';
import { ObserveQuery } from '../graphql/queries/ObserveQuery';

interface FetchCustomEventsOptions {
  eventName?: string;
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
  orderBy?: AppObserveUserEventListOrderBy;
}

interface FetchCustomEventsResult {
  events: AppObserveUserEvent[];
  pageInfo: PageInfo;
}

export async function fetchObserveCustomEventsAsync(
  graphqlClient: ExpoGraphqlClient,
  appId: string,
  options: FetchCustomEventsOptions
): Promise<FetchCustomEventsResult> {
  const filter: AppObserveUserEventListFilter = {
    ...(options.startTime && { startTime: options.startTime }),
    ...(options.endTime && { endTime: options.endTime }),
    ...(options.eventName && { name: options.eventName }),
    ...(options.platforms?.length && { platforms: options.platforms }),
    ...(options.appVersion && { appVersion: options.appVersion }),
    ...(options.buildNumber && { appBuildNumber: options.buildNumber }),
    ...(options.updateId && { appUpdateId: options.updateId }),
    ...(options.sessionId && { sessionId: options.sessionId }),
    ...(options.environment && { environment: options.environment }),
  };

  return await ObserveQuery.customEventListAsync(graphqlClient, {
    appId,
    filter,
    first: options.limit,
    ...(options.after && { after: options.after }),
    ...(options.orderBy && { orderBy: options.orderBy }),
  });
}
