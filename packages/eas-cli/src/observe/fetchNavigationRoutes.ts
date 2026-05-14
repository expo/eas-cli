import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import {
  AppObserveEventsOrderByDirection,
  AppObserveNavigationRoute,
  AppObserveNavigationRoutesOrderBy,
  AppObserveNavigationRoutesOrderByField,
  AppPlatform,
  PageInfo,
} from '../graphql/generated';
import { ObserveQuery } from '../graphql/queries/ObserveQuery';
import Log from '../log';
import { appPlatformToObservePlatform } from './platforms';

export interface NavigationRouteWithPlatform {
  platform: AppPlatform;
  route: AppObserveNavigationRoute;
}

export interface FetchNavigationRoutesOptions {
  startTime: string;
  endTime: string;
  platforms: AppPlatform[];
  limit: number;
  after?: string;
  appVersion?: string;
  updateId?: string;
  buildNumber?: string;
  orderBy?: AppObserveNavigationRoutesOrderBy;
}

export interface FetchNavigationRoutesResult {
  routes: NavigationRouteWithPlatform[];
  pageInfoByPlatform: Map<AppPlatform, PageInfo>;
}

export async function fetchObserveNavigationRoutesAsync(
  graphqlClient: ExpoGraphqlClient,
  appId: string,
  options: FetchNavigationRoutesOptions
): Promise<FetchNavigationRoutesResult> {
  const orderBy: AppObserveNavigationRoutesOrderBy = options.orderBy ?? {
    field: AppObserveNavigationRoutesOrderByField.NavigationCount,
    direction: AppObserveEventsOrderByDirection.Desc,
  };

  const queries = options.platforms.map(async appPlatform => {
    const observePlatform = appPlatformToObservePlatform[appPlatform];
    try {
      const result = await ObserveQuery.navigationRoutesAsync(graphqlClient, {
        appId,
        filter: {
          platform: observePlatform,
          startTime: options.startTime,
          endTime: options.endTime,
          ...(options.appVersion && { appVersion: options.appVersion }),
          ...(options.updateId && { appUpdateId: options.updateId }),
          ...(options.buildNumber && { appBuildNumber: options.buildNumber }),
        },
        first: options.limit,
        ...(options.after && { after: options.after }),
        orderBy,
      });
      return { appPlatform, ...result };
    } catch (error: any) {
      Log.warn(`Failed to fetch navigation routes on ${observePlatform}: ${error.message}`);
      return null;
    }
  });

  const results = await Promise.all(queries);

  const routes: NavigationRouteWithPlatform[] = [];
  const pageInfoByPlatform = new Map<AppPlatform, PageInfo>();

  for (const result of results) {
    if (!result) {
      continue;
    }
    pageInfoByPlatform.set(result.appPlatform, result.pageInfo);
    for (const route of result.routes) {
      routes.push({ platform: result.appPlatform, route });
    }
  }

  return { routes, pageInfoByPlatform };
}
