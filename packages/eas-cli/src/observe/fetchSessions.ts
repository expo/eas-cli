import semver from 'semver';

import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import {
  AppObserveCustomEvent,
  AppObserveEvent,
  AppObserveEventsOrderByDirection,
  AppObserveEventsOrderByField,
  AppObservePlatform,
} from '../graphql/generated';
import { fetchObserveCustomEventsAsync } from './fetchCustomEvents';
import { fetchObserveEventsAsync } from './fetchEvents';

function compareAppVersionsDesc(a: string, b: string): number {
  const av = semver.coerce(a);
  const bv = semver.coerce(b);
  if (av && bv) {
    return semver.rcompare(av, bv);
  }
  return b.localeCompare(a);
}

function compareSessionsForListing(a: SessionSummary, b: SessionSummary): number {
  if (a.deviceOs !== b.deviceOs) {
    return a.deviceOs.localeCompare(b.deviceOs);
  }
  const versionCmp = compareAppVersionsDesc(a.appVersion, b.appVersion);
  if (versionCmp !== 0) {
    return versionCmp;
  }
  if (a.firstSeenAt > b.firstSeenAt) {
    return -1;
  }
  if (a.firstSeenAt < b.firstSeenAt) {
    return 1;
  }
  return 0;
}

export interface FetchSessionsOptions {
  startTime: string;
  endTime: string;
  platform?: AppObservePlatform;
  appVersion?: string;
  updateId?: string;
  eventName?: string;
  limit: number;
}

export interface SessionSummary {
  sessionId: string;
  firstSeenAt: string;
  lastSeenAt: string;
  appVersion: string;
  appBuildNumber: string;
  deviceOs: string;
  deviceOsVersion: string;
  deviceModel: string;
}

export interface FetchSessionListResult {
  sessions: SessionSummary[];
  /** Total metric-event samples scanned to derive the session list. */
  scannedMetricEventCount: number;
  /** Total log-event samples scanned to derive the session list. */
  scannedLogEventCount: number;
  /** True when either underlying query reported more pages — the list may
   *  miss older sessions in the window. */
  isTruncated: boolean;
}

function recordSession(
  sessions: Map<string, SessionSummary>,
  sessionId: string | null | undefined,
  timestamp: string,
  context: {
    appVersion: string;
    appBuildNumber: string;
    deviceOs: string;
    deviceOsVersion: string;
    deviceModel: string;
  }
): void {
  if (!sessionId) {
    return;
  }
  const existing = sessions.get(sessionId);
  if (!existing) {
    sessions.set(sessionId, {
      sessionId,
      firstSeenAt: timestamp,
      lastSeenAt: timestamp,
      ...context,
    });
    return;
  }
  if (timestamp < existing.firstSeenAt) {
    existing.firstSeenAt = timestamp;
  }
  if (timestamp > existing.lastSeenAt) {
    existing.lastSeenAt = timestamp;
  }
}

export async function fetchObserveSessionListAsync(
  graphqlClient: ExpoGraphqlClient,
  appId: string,
  options: FetchSessionsOptions
): Promise<FetchSessionListResult> {
  const [metricResult, logResult] = await Promise.all([
    fetchObserveEventsAsync(graphqlClient, appId, {
      orderBy: {
        field: AppObserveEventsOrderByField.Timestamp,
        direction: AppObserveEventsOrderByDirection.Desc,
      },
      limit: options.limit,
      startTime: options.startTime,
      endTime: options.endTime,
      platform: options.platform,
      appVersion: options.appVersion,
      updateId: options.updateId,
    }),
    fetchObserveCustomEventsAsync(graphqlClient, appId, {
      limit: options.limit,
      startTime: options.startTime,
      endTime: options.endTime,
      platform: options.platform,
      appVersion: options.appVersion,
      updateId: options.updateId,
      eventName: options.eventName,
    }),
  ]);

  const sessions = new Map<string, SessionSummary>();

  for (const event of metricResult.events) {
    recordSession(sessions, event.sessionId, event.timestamp, {
      appVersion: event.appVersion,
      appBuildNumber: event.appBuildNumber,
      deviceOs: event.deviceOs,
      deviceOsVersion: event.deviceOsVersion,
      deviceModel: event.deviceModel,
    });
  }
  for (const event of logResult.events) {
    recordSession(sessions, event.sessionId, event.timestamp, {
      appVersion: event.appVersion,
      appBuildNumber: event.appBuildNumber,
      deviceOs: event.deviceOs,
      deviceOsVersion: event.deviceOsVersion,
      deviceModel: event.deviceModel,
    });
  }

  if (options.eventName) {
    const eligibleSessionIds = new Set(
      logResult.events.map(e => e.sessionId).filter((id): id is string => id != null && id !== '')
    );
    for (const id of [...sessions.keys()]) {
      if (!eligibleSessionIds.has(id)) {
        sessions.delete(id);
      }
    }
  }

  const sortedSessions = Array.from(sessions.values()).sort(compareSessionsForListing);

  return {
    sessions: sortedSessions,
    scannedMetricEventCount: metricResult.events.length,
    scannedLogEventCount: logResult.events.length,
    isTruncated: metricResult.pageInfo.hasNextPage || logResult.pageInfo.hasNextPage,
  };
}

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

export interface FetchSessionEventsOptions {
  startTime: string;
  endTime: string;
  sessionId: string;
  platform?: AppObservePlatform;
  appVersion?: string;
  updateId?: string;
  limit: number;
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
      startTime: options.startTime,
      endTime: options.endTime,
      platform: options.platform,
      appVersion: options.appVersion,
      updateId: options.updateId,
      sessionId: options.sessionId,
    }),
    fetchObserveCustomEventsAsync(graphqlClient, appId, {
      limit: options.limit,
      startTime: options.startTime,
      endTime: options.endTime,
      platform: options.platform,
      appVersion: options.appVersion,
      updateId: options.updateId,
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
