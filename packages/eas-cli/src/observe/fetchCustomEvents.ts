import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import {
  AppObserveCustomEvent,
  AppObserveCustomEventListFilter,
  AppObservePlatform,
  PageInfo,
} from '../graphql/generated';
import { ObserveQuery } from '../graphql/queries/ObserveQuery';

interface FetchCustomEventsOptions {
  eventName?: string;
  limit: number;
  after?: string;
  startTime: string;
  endTime: string;
  platform?: AppObservePlatform;
  appVersion?: string;
  updateId?: string;
  sessionId?: string;
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
    startTime: options.startTime,
    endTime: options.endTime,
    ...(options.eventName && { eventName: options.eventName }),
    ...(options.platform && { platform: options.platform }),
    ...(options.appVersion && { appVersion: options.appVersion }),
    ...(options.updateId && { appUpdateId: options.updateId }),
    ...(options.sessionId && { sessionId: options.sessionId }),
  };

  return await ObserveQuery.customEventListAsync(graphqlClient, {
    appId,
    filter,
    first: options.limit,
    ...(options.after && { after: options.after }),
  });
}
