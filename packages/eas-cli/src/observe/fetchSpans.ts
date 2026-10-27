import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import {
  AppObservePlatform,
  AppObserveSpan,
  AppObserveSpanKind,
  AppObserveSpanListFilter,
  AppObserveSpanStatusCode,
  PageInfo,
} from '../graphql/generated';
import { ObserveQuery } from '../graphql/queries/ObserveQuery';

export interface FetchSpansOptions {
  limit: number;
  after?: string;
  startTime: string;
  endTime: string;
  platforms?: AppObservePlatform[];
  appVersion?: string;
  buildNumber?: string;
  updateId?: string;
  environment?: string;
  sessionId?: string;
  names?: string[];
  kinds?: AppObserveSpanKind[];
  statusCodes?: AppObserveSpanStatusCode[];
  hosts?: string[];
  httpStatusCodes?: number[];
  minDurationMs?: number;
  rootOnly?: boolean;
}

export interface FetchSpansResult {
  spans: AppObserveSpan[];
  pageInfo: PageInfo;
}

export async function fetchObserveSpansAsync(
  graphqlClient: ExpoGraphqlClient,
  appId: string,
  options: FetchSpansOptions
): Promise<FetchSpansResult> {
  const filter: AppObserveSpanListFilter = {
    startTime: options.startTime,
    endTime: options.endTime,
    ...(options.platforms?.length && { platforms: options.platforms }),
    ...(options.appVersion && { appVersion: options.appVersion }),
    ...(options.buildNumber && { appBuildNumber: options.buildNumber }),
    ...(options.updateId && { appUpdateId: options.updateId }),
    ...(options.environment && { environment: options.environment }),
    ...(options.sessionId && { sessionId: options.sessionId }),
    ...(options.names?.length && { names: options.names }),
    ...(options.kinds?.length && { kinds: options.kinds }),
    ...(options.statusCodes?.length && { statusCodes: options.statusCodes }),
    ...(options.hosts?.length && { hosts: options.hosts }),
    ...(options.httpStatusCodes?.length && { httpStatusCodes: options.httpStatusCodes }),
    ...(options.minDurationMs != null && { minDurationMs: options.minDurationMs }),
    ...(options.rootOnly && { rootOnly: true }),
  };

  return await ObserveQuery.spanListAsync(graphqlClient, {
    appId,
    filter,
    first: options.limit,
    ...(options.after && { after: options.after }),
  });
}
