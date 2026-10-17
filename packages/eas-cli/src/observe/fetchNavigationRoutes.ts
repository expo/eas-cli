import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import {
  AppObserveNavigationOrderBy,
  AppObserveNavigationRoute,
  AppObserveNavigationRoutesOrderByField,
  AppObserveOrderDirection,
  PageInfo,
} from '../graphql/generated';
import { ObserveQuery } from '../graphql/queries/ObserveQuery';
import Log from '../log';
import { isObservePlanGateError } from './planGating';
import {
  ObservePlatformKey,
  ObservePlatformTarget,
  observePlatformDisplayNames,
} from './platforms';

export interface NavigationRouteWithPlatform {
  platform: ObservePlatformKey;
  route: AppObserveNavigationRoute;
}

export interface FetchNavigationRoutesOptions {
  startTime: string;
  endTime: string;
  targets: ObservePlatformTarget[];
  limit: number;
  after?: string;
  appVersion?: string;
  updateId?: string;
  buildNumber?: string;
  routeNames?: string[];
  environment?: string;
  orderBy?: AppObserveNavigationOrderBy;
}

export interface FetchNavigationRoutesResult {
  routes: NavigationRouteWithPlatform[];
  pageInfoByPlatform: Map<ObservePlatformKey, PageInfo>;
}

export async function fetchObserveNavigationRoutesAsync(
  graphqlClient: ExpoGraphqlClient,
  appId: string,
  options: FetchNavigationRoutesOptions
): Promise<FetchNavigationRoutesResult> {
  const orderBy: AppObserveNavigationOrderBy = options.orderBy ?? {
    field: AppObserveNavigationRoutesOrderByField.NavigationCount,
    direction: AppObserveOrderDirection.Desc,
  };

  const queries = options.targets.map(async target => {
    try {
      const result = await ObserveQuery.navigationRoutesAsync(graphqlClient, {
        appId,
        filter: {
          platforms: target.platforms,
          startTime: options.startTime,
          endTime: options.endTime,
          ...(options.appVersion && { appVersion: options.appVersion }),
          ...(options.updateId && { appUpdateId: options.updateId }),
          ...(options.buildNumber && { appBuildNumber: options.buildNumber }),
          ...(options.routeNames?.length && { routeNames: options.routeNames }),
          ...(options.environment && { environment: options.environment }),
        },
        first: options.limit,
        ...(options.after && { after: options.after }),
        orderBy,
      });
      return { target, ...result };
    } catch (error: any) {
      // A plan gate is an account-wide rejection, not a per-platform failure —
      // let it propagate so the command surfaces the upgrade prompt.
      if (isObservePlanGateError(error)) {
        throw error;
      }
      Log.warn(
        `Failed to fetch navigation routes on ${observePlatformDisplayNames[target.key]}: ${
          error.message
        }`
      );
      return null;
    }
  });

  const results = await Promise.all(queries);

  const routes: NavigationRouteWithPlatform[] = [];
  const pageInfoByPlatform = new Map<ObservePlatformKey, PageInfo>();

  for (const result of results) {
    if (!result) {
      continue;
    }
    pageInfoByPlatform.set(result.target.key, result.pageInfo);
    for (const route of result.routes) {
      routes.push({ platform: result.target.key, route });
    }
  }

  return { routes, pageInfoByPlatform };
}
