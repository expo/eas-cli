import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { AppObservePlatform, AppObserveVersionMarker, AppPlatform } from '../graphql/generated';
import { ObserveQuery } from '../graphql/queries/ObserveQuery';
import Log from '../log';
import { MetricValues, ObserveMetricsMap, makeMetricsKey } from './formatMetrics';

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

export async function fetchObserveMetricsAsync(
  graphqlClient: ExpoGraphqlClient,
  appId: string,
  metricNames: string[],
  platforms: AppPlatform[],
  startTime: string,
  endTime: string
): Promise<ObserveMetricsMap> {
  const observeQueries: Promise<ObserveQueryResult | null>[] = [];

  // TODO(@ubax): add support for fetching multiple metrics and platforms in a single query
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
        average: marker.statistics.average,
        p80: marker.statistics.p80,
        p90: marker.statistics.p90,
        p99: marker.statistics.p99,
        eventCount: marker.eventCount,
      };
      metricsMap.get(key)!.set(metricName, values);
    }
  }

  return metricsMap;
}
