import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import {
  AppObserveError,
  AppObserveErrorGroup,
  AppObserveErrorOccurrencesOrderByField,
  AppObserveErrorSeverity,
  AppObserveOrderDirection,
  AppObservePlatform,
  PageInfo,
} from '../graphql/generated';
import { ObserveQuery } from '../graphql/queries/ObserveQuery';

export interface FetchObserveErrorGroupsOptions {
  startTime: string;
  endTime: string;
  platforms?: AppObservePlatform[];
  appVersion?: string;
  buildNumber?: string;
  updateId?: string;
  environment?: string;
  severity?: AppObserveErrorSeverity;
}

export async function fetchObserveErrorGroupsAsync(
  graphqlClient: ExpoGraphqlClient,
  appId: string,
  options: FetchObserveErrorGroupsOptions
): Promise<{ groups: AppObserveErrorGroup[]; isTruncated: boolean }> {
  return await ObserveQuery.errorGroupsAsync(graphqlClient, {
    appId,
    input: {
      startTime: options.startTime,
      endTime: options.endTime,
      ...(options.platforms?.length && { platforms: options.platforms }),
      ...(options.appVersion && { appVersion: options.appVersion }),
      ...(options.buildNumber && { appBuildNumber: options.buildNumber }),
      ...(options.updateId && { appUpdateId: options.updateId }),
      ...(options.environment && { environment: options.environment }),
      ...(options.severity && { severity: options.severity }),
    },
  });
}

export interface FetchObserveErrorOccurrencesOptions {
  fingerprint: string;
  startTime: string;
  endTime: string;
  platforms?: AppObservePlatform[];
  appVersion?: string;
  buildNumber?: string;
  updateId?: string;
  environment?: string;
  limit: number;
  after?: string;
}

export async function fetchObserveErrorOccurrencesAsync(
  graphqlClient: ExpoGraphqlClient,
  appId: string,
  options: FetchObserveErrorOccurrencesOptions
): Promise<{ occurrences: AppObserveError[]; pageInfo: PageInfo }> {
  return await ObserveQuery.errorOccurrencesAsync(graphqlClient, {
    appId,
    filter: {
      fingerprint: options.fingerprint,
      startTime: options.startTime,
      endTime: options.endTime,
      ...(options.platforms?.length && { platforms: options.platforms }),
      ...(options.appVersion && { appVersion: options.appVersion }),
      ...(options.buildNumber && { appBuildNumber: options.buildNumber }),
      ...(options.updateId && { appUpdateId: options.updateId }),
      ...(options.environment && { environment: options.environment }),
    },
    first: options.limit,
    ...(options.after && { after: options.after }),
    orderBy: {
      field: AppObserveErrorOccurrencesOrderByField.Timestamp,
      direction: AppObserveOrderDirection.Desc,
    },
  });
}
