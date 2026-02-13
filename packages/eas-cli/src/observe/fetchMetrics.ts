import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { EasCommandError } from '../commandUtils/errors';
import {
  AppObservePlatform,
  AppObserveVersionMarker,
  AppPlatform,
} from '../graphql/generated';
import { ObserveQuery } from '../graphql/queries/ObserveQuery';
import Log from '../log';
import { MetricValues, ObserveMetricsMap, makeMetricsKey } from './formatMetrics';

export const DEFAULT_METRICS = [
  'expo.app_startup.cold_launch_time',
  'expo.app_startup.warm_launch_time',
  'expo.app_startup.tti',
  'expo.app_startup.ttr',
  'expo.app_startup.bundle_load_time',
];

export const DEFAULT_LIMIT = 10;
export const DEFAULT_DAYS_BACK = 60;

const appPlatformToObservePlatform: Record<AppPlatform, AppObservePlatform> = {
  [AppPlatform.Android]: AppObservePlatform.Android,
  [AppPlatform.Ios]: AppObservePlatform.Ios,
};

const observePlatformToAppPlatform: Record<AppObservePlatform, AppPlatform> = {
  [AppObservePlatform.Android]: AppPlatform.Android,
  [AppObservePlatform.Ios]: AppPlatform.Ios,
};

interface ObserveQueryResult {
  metricName: string;
  platform: AppObservePlatform;
  markers: AppObserveVersionMarker[];
}

export function validateDateFlag(value: string, flagName: string): void {
  const parsed = new Date(value);
  if (isNaN(parsed.getTime())) {
    throw new EasCommandError(
      `Invalid ${flagName} date: "${value}". Provide a valid ISO 8601 date (e.g. 2025-01-01).`
    );
  }
}

export async function fetchObserveMetricsAsync(
  graphqlClient: ExpoGraphqlClient,
  appId: string,
  metricNames: string[],
  platforms: Set<AppPlatform>,
  startTime: string,
  endTime: string
): Promise<ObserveMetricsMap> {
  const observeQueries: Promise<ObserveQueryResult | null>[] = [];

  for (const metricName of metricNames) {
    for (const appPlatform of platforms) {
      const observePlatform = appPlatformToObservePlatform[appPlatform];
      observeQueries.push(
        ObserveQuery.timeSeriesVersionMarkersAsync(graphqlClient, {
          appId,
          metricName,
          platform: observePlatform,
          startTime,
          endTime,
        })
          .then(markers => ({
            metricName,
            platform: observePlatform,
            markers,
          }))
          .catch(error => {
            Log.warn(
              `Failed to fetch observe data for metric "${metricName}" on ${observePlatform}: ${error.message}`
            );
            return null;
          })
      );
    }
  }

  const observeResults = await Promise.all(observeQueries);

  const metricsMap: ObserveMetricsMap = new Map();

  for (const result of observeResults) {
    if (!result) {
      continue;
    }
    const { metricName, platform, markers } = result;
    const appPlatform = observePlatformToAppPlatform[platform];
    for (const marker of markers) {
      const key = makeMetricsKey(marker.appVersion, appPlatform);
      if (!metricsMap.has(key)) {
        metricsMap.set(key, new Map());
      }
      const values: MetricValues = {
        min: marker.statistics.min,
        max: marker.statistics.max,
        median: marker.statistics.median,
      };
      metricsMap.get(key)!.set(metricName, values);
    }
  }

  return metricsMap;
}
