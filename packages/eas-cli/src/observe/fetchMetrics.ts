import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { EasCommandError } from '../commandUtils/errors';
import { AppObservePlatform, AppPlatform } from '../graphql/generated';
import { AppObserveTimeSeriesResult, ObserveQuery } from '../graphql/queries/ObserveQuery';
import Log from '../log';
import { BuildNumbersMap, MetricValues, ObserveMetricsMap, makeMetricsKey } from './formatMetrics';

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
  timeSeries: AppObserveTimeSeriesResult;
}

export function validateDateFlag(value: string, flagName: string): void {
  const parsed = new Date(value);
  if (isNaN(parsed.getTime())) {
    throw new EasCommandError(
      `Invalid ${flagName} date: "${value}". Provide a valid ISO 8601 date (e.g. 2025-01-01).`
    );
  }
}

export interface FetchObserveMetricsResult {
  metricsMap: ObserveMetricsMap;
  buildNumbersMap: BuildNumbersMap;
}

export async function fetchObserveMetricsAsync(
  graphqlClient: ExpoGraphqlClient,
  appId: string,
  metricNames: string[],
  platforms: AppPlatform[],
  startTime: string,
  endTime: string
): Promise<FetchObserveMetricsResult> {
  const observeQueries: Promise<ObserveQueryResult | null>[] = [];

  for (const metricName of metricNames) {
    for (const appPlatform of platforms) {
      const observePlatform = appPlatformToObservePlatform[appPlatform];
      observeQueries.push(
        ObserveQuery.timeSeriesAsync(graphqlClient, {
          appId,
          metricName,
          platform: observePlatform,
          startTime,
          endTime,
        })
          .then(timeSeries => ({
            metricName,
            platform: observePlatform,
            timeSeries,
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
  const buildNumbersMap: BuildNumbersMap = new Map();

  for (const result of observeResults) {
    if (!result) {
      continue;
    }
    const { metricName, platform, timeSeries } = result;
    const appPlatform = observePlatformToAppPlatform[platform];
    const { statistics } = timeSeries;

    for (const marker of timeSeries.appVersionMarkers) {
      const key = makeMetricsKey(marker.appVersion, appPlatform);
      if (!metricsMap.has(key)) {
        metricsMap.set(key, new Map());
      }
      if (!buildNumbersMap.has(key)) {
        buildNumbersMap.set(
          key,
          marker.buildNumbers.map(bn => bn.appBuildNumber)
        );
      }
      const values: MetricValues = {
        min: statistics.min,
        max: statistics.max,
        median: statistics.median,
        average: statistics.average,
        p80: statistics.p80,
        p90: statistics.p90,
        p99: statistics.p99,
        eventCount: marker.eventCount,
      };
      metricsMap.get(key)!.set(metricName, values);
    }
  }

  return { metricsMap, buildNumbersMap };
}
