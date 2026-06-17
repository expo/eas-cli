import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import {
  AppObserveCustomEvent,
  AppObserveEvent,
  AppObserveEventsOrderByDirection,
  AppObserveEventsOrderByField,
} from '../graphql/generated';
import { fetchObserveCustomEventsAsync } from './fetchCustomEvents';
import { fetchObserveEventsAsync } from './fetchEvents';

export interface SessionEventEntry {
  source: 'metric' | 'log';
  timestamp: string;
  sessionId: string;
  appVersion: string;
  appBuildNumber: string;
  appUpdateId: string | null;
  deviceModel: string;
  deviceOs: string;
  deviceOsVersion: string;
  countryCode: string | null;
  easClientId: string;
  // metric-only fields
  metricName?: string;
  metricValue?: number;
  customParams?: { [key: string]: any } | null;
  routeName?: string | null;
  // log-only fields
  eventName?: string;
  severityText?: string | null;
  severityNumber?: number | null;
  properties?: Array<{ key: string; value: string; type: string }>;
  environment?: string | null;
}

function metricEventToEntry(event: AppObserveEvent): SessionEventEntry {
  return {
    source: 'metric',
    timestamp: event.timestamp,
    sessionId: event.sessionId ?? '',
    appVersion: event.appVersion,
    appBuildNumber: event.appBuildNumber,
    appUpdateId: event.appUpdateId ?? null,
    deviceModel: event.deviceModel,
    deviceOs: event.deviceOs,
    deviceOsVersion: event.deviceOsVersion,
    countryCode: event.countryCode ?? null,
    easClientId: event.easClientId,
    metricName: event.metricName,
    metricValue: event.metricValue,
    customParams: event.customParams ?? null,
    routeName: event.routeName ?? null,
  };
}

function customEventToEntry(event: AppObserveCustomEvent): SessionEventEntry {
  return {
    source: 'log',
    timestamp: event.timestamp,
    sessionId: event.sessionId ?? '',
    appVersion: event.appVersion,
    appBuildNumber: event.appBuildNumber,
    appUpdateId: event.appUpdateId ?? null,
    deviceModel: event.deviceModel,
    deviceOs: event.deviceOs,
    deviceOsVersion: event.deviceOsVersion,
    countryCode: event.countryCode ?? null,
    easClientId: event.easClientId,
    eventName: event.eventName,
    severityText: event.severityText ?? null,
    severityNumber: event.severityNumber ?? null,
    properties: event.properties.map(p => ({ key: p.key, value: p.value, type: p.type })),
    environment: event.environment ?? null,
  };
}

export interface SessionMetadata {
  appVersion: string;
  appBuildNumber: string;
  appUpdateId: string | null;
  deviceOs: string;
  deviceOsVersion: string;
  deviceModel: string;
  countryCode: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface FetchSessionEventsOptions {
  sessionId: string;
  limit: number;
}

export interface FetchSessionEventsResult {
  entries: SessionEventEntry[];
  metadata: SessionMetadata | null;
  hasMoreMetricEvents: boolean;
  hasMoreLogEvents: boolean;
}

export async function fetchObserveSessionEventsAsync(
  graphqlClient: ExpoGraphqlClient,
  appId: string,
  options: FetchSessionEventsOptions
): Promise<FetchSessionEventsResult> {
  const [metricResult, logResult] = await Promise.all([
    fetchObserveEventsAsync(graphqlClient, appId, {
      orderBy: {
        field: AppObserveEventsOrderByField.Timestamp,
        direction: AppObserveEventsOrderByDirection.Asc,
      },
      limit: options.limit,
      sessionId: options.sessionId,
    }),
    fetchObserveCustomEventsAsync(graphqlClient, appId, {
      limit: options.limit,
      sessionId: options.sessionId,
    }),
  ]);

  const entries = [
    ...metricResult.events.map(metricEventToEntry),
    ...logResult.events.map(customEventToEntry),
  ].sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));

  let metadata: SessionMetadata | null = null;
  if (entries.length > 0) {
    const newest = entries[entries.length - 1];
    metadata = {
      appVersion: newest.appVersion,
      appBuildNumber: newest.appBuildNumber,
      appUpdateId: newest.appUpdateId,
      deviceOs: newest.deviceOs,
      deviceOsVersion: newest.deviceOsVersion,
      deviceModel: newest.deviceModel,
      countryCode: newest.countryCode,
      firstSeenAt: entries[0].timestamp,
      lastSeenAt: newest.timestamp,
    };
  }

  return {
    entries,
    metadata,
    hasMoreMetricEvents: metricResult.pageInfo.hasNextPage,
    hasMoreLogEvents: logResult.pageInfo.hasNextPage,
  };
}
