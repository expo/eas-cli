import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import {
  AppObserveErrorGroup,
  AppObserveErrorSeverity,
  AppObservePlatform,
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
