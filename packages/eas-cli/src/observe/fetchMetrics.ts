import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { EasCommandError } from '../commandUtils/errors';
import { ObserveQuery } from '../graphql/queries/ObserveQuery';
import Log from '../log';
import {
  BuildNumbersMap,
  MetricValues,
  ObserveMetricsMap,
  UpdateIdsMap,
  makeMetricsKey,
} from './formatMetrics';
import { isObservePlanGateError } from './planGating';
import { ObservePlatformTarget, observePlatformDisplayNames } from './platforms';

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
  updateIdsMap: UpdateIdsMap;
  totalEventCounts: Map<string, number>;
}

export async function fetchObserveMetricsAsync(
  graphqlClient: ExpoGraphqlClient,
  appId: string,
  metricNames: string[],
  targets: ObservePlatformTarget[],
  startTime: string,
  endTime: string,
  environment?: string
): Promise<FetchObserveMetricsResult> {
  const queries = targets.map(async target => {
    try {
      const appVersions = await ObserveQuery.appVersionsAsync(graphqlClient, {
        appId,
        platforms: target.platforms,
        startTime,
        endTime,
        metricNames,
        environment,
      });
      return { target, appVersions };
    } catch (error: any) {
      // A plan gate is an account-wide rejection, not a per-platform failure —
      // let it propagate so the command surfaces the upgrade prompt.
      if (isObservePlanGateError(error)) {
        throw error;
      }
      Log.warn(
        `Failed to fetch observe data on ${observePlatformDisplayNames[target.key]}: ${
          error.message
        }`
      );
      return null;
    }
  });

  const results = await Promise.all(queries);

  const metricsMap: ObserveMetricsMap = new Map();
  const buildNumbersMap: BuildNumbersMap = new Map();
  const updateIdsMap: UpdateIdsMap = new Map();
  const totalEventCounts = new Map<string, number>();

  for (const result of results) {
    if (!result) {
      continue;
    }
    const { target, appVersions } = result;

    for (const version of appVersions) {
      const key = makeMetricsKey(version.appVersion, target.key);
      if (!metricsMap.has(key)) {
        metricsMap.set(key, new Map());
      }
      if (!buildNumbersMap.has(key)) {
        buildNumbersMap.set(
          key,
          version.buildNumbers.map(bn => bn.appBuildNumber)
        );
      }
      if (!updateIdsMap.has(key)) {
        updateIdsMap.set(
          key,
          version.updates.map(u => u.appUpdateId)
        );
      }

      for (const metric of version.metrics) {
        const values: MetricValues = {
          min: metric.statistics.min,
          max: metric.statistics.max,
          median: metric.statistics.median,
          average: metric.statistics.average,
          p80: metric.statistics.p80,
          p90: metric.statistics.p90,
          p99: metric.statistics.p99,
          eventCount: metric.eventCount,
        };
        metricsMap.get(key)!.set(metric.metricName, values);

        const eventCountKey = `${metric.metricName}:${target.key}`;
        totalEventCounts.set(
          eventCountKey,
          (totalEventCounts.get(eventCountKey) ?? 0) + metric.eventCount
        );
      }
    }
  }

  return { metricsMap, buildNumbersMap, updateIdsMap, totalEventCounts };
}
