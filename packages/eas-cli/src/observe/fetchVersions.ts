import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { AppObserveAppVersion, AppObservePlatform, AppPlatform } from '../graphql/generated';
import { ObserveQuery } from '../graphql/queries/ObserveQuery';
import Log from '../log';

const appPlatformToObservePlatform: Record<AppPlatform, AppObservePlatform> = {
  [AppPlatform.Android]: AppObservePlatform.Android,
  [AppPlatform.Ios]: AppObservePlatform.Ios,
};

export interface AppVersionsResult {
  platform: AppPlatform;
  appVersions: AppObserveAppVersion[];
}

export async function fetchObserveVersionsAsync(
  graphqlClient: ExpoGraphqlClient,
  appId: string,
  platforms: AppPlatform[],
  startTime: string,
  endTime: string
): Promise<AppVersionsResult[]> {
  const queries = platforms.map(async (appPlatform): Promise<AppVersionsResult | null> => {
    const observePlatform = appPlatformToObservePlatform[appPlatform];
    try {
      const appVersions = await ObserveQuery.appVersionsAsync(graphqlClient, {
        appId,
        platform: observePlatform,
        startTime,
        endTime,
      });
      return { platform: appPlatform, appVersions };
    } catch (error: any) {
      Log.warn(`Failed to fetch app versions for ${observePlatform}: ${error.message}`);
      return null;
    }
  });

  const results = await Promise.all(queries);
  return results.filter((r): r is AppVersionsResult => r !== null);
}
