import { EasCommandError } from '../commandUtils/errors';
import { AppPlatform } from '../graphql/generated';
import type { ObserveMetricsKey } from './metrics.types';

export function makeMetricsKey(appVersion: string, platform: AppPlatform): ObserveMetricsKey {
  return `${appVersion}:${platform}`;
}

export function parseMetricsKey(key: ObserveMetricsKey): {
  appVersion: string;
  platform: AppPlatform;
} {
  const lastColon = key.lastIndexOf(':');
  return {
    appVersion: key.slice(0, lastColon),
    platform: key.slice(lastColon + 1) as AppPlatform,
  };
}

export function validateDateFlag(value: string, flagName: string): void {
  const parsed = new Date(value);
  if (isNaN(parsed.getTime())) {
    throw new EasCommandError(
      `Invalid ${flagName} date: "${value}". Provide a valid ISO 8601 date (e.g. 2025-01-01).`
    );
  }
}
