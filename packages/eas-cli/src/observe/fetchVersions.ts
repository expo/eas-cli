import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { AppObserveAppVersion } from '../graphql/generated';
import { ObserveQuery } from '../graphql/queries/ObserveQuery';
import Log from '../log';
import {
  ObservePlatformKey,
  ObservePlatformTarget,
  observePlatformDisplayNames,
} from './platforms';

export interface AppVersionsResult {
  platform: ObservePlatformKey;
  appVersions: AppObserveAppVersion[];
}

export async function fetchObserveVersionsAsync(
  graphqlClient: ExpoGraphqlClient,
  appId: string,
  targets: ObservePlatformTarget[],
  startTime: string,
  endTime: string,
  environment?: string
): Promise<AppVersionsResult[]> {
  const queries = targets.map(async (target): Promise<AppVersionsResult | null> => {
    try {
      const appVersions = await ObserveQuery.appVersionsAsync(graphqlClient, {
        appId,
        platforms: target.platforms,
        startTime,
        endTime,
        environment,
      });
      return { platform: target.key, appVersions };
    } catch (error: any) {
      Log.warn(
        `Failed to fetch app versions for ${observePlatformDisplayNames[target.key]}: ${
          error.message
        }`
      );
      return null;
    }
  });

  const results = await Promise.all(queries);
  return results.filter((r): r is AppVersionsResult => r !== null);
}
