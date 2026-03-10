import type { AppPlatform } from '../graphql/generated';

export interface MetricValues {
  min: number | null | undefined;
  max: number | null | undefined;
  median: number | null | undefined;
  average: number | null | undefined;
  p80: number | null | undefined;
  p90: number | null | undefined;
  p99: number | null | undefined;
  eventCount: number | null | undefined;
}

/**
 * ObserveMetricsKey encodes an app version + platform pair into a single string key.
 * This is needed because the observe API returns metrics per (version, platform) combination,
 * and we use a flat Map
 */
export type ObserveMetricsKey = `${string}:${AppPlatform}`;

export type ObserveMetricsMap = Map<ObserveMetricsKey, Map<string, MetricValues>>;
