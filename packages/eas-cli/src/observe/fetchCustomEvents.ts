import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import {
  AppObserveCustomEvent,
  AppObserveCustomEventListFilter,
  AppObserveCustomEventListOrderBy,
  AppObservePlatform,
  PageInfo,
} from '../graphql/generated';
import { ObserveQuery } from '../graphql/queries/ObserveQuery';

interface FetchCustomEventsOptions {
  eventName?: string;
  limit: number;
  after?: string;
  startTime?: string;
  endTime?: string;
  platform?: AppObservePlatform;
  appVersion?: string;
  updateId?: string;
  sessionId?: string;
  easClientId?: string;
  orderBy?: AppObserveCustomEventListOrderBy;
}

interface FetchCustomEventsResult {
  events: AppObserveCustomEvent[];
  pageInfo: PageInfo;
}

export async function fetchObserveCustomEventsAsync(
  graphqlClient: ExpoGraphqlClient,
  appId: string,
  options: FetchCustomEventsOptions
): Promise<FetchCustomEventsResult> {
  const filter: AppObserveCustomEventListFilter = {
    ...(options.startTime && { startTime: options.startTime }),
    ...(options.endTime && { endTime: options.endTime }),
    ...(options.eventName && { eventName: options.eventName }),
    ...(options.platform && { platform: options.platform }),
    ...(options.appVersion && { appVersion: options.appVersion }),
    ...(options.updateId && { appUpdateId: options.updateId }),
    ...(options.sessionId && { sessionId: options.sessionId }),
    ...(options.easClientId && { easClientId: options.easClientId }),
  };

  return await ObserveQuery.customEventListAsync(graphqlClient, {
    appId,
    filter,
    first: options.limit,
    ...(options.after && { after: options.after }),
    ...(options.orderBy && { orderBy: options.orderBy }),
  });
}
