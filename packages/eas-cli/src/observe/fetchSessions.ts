import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import {
  AppObserveCustomEvent,
  AppObserveCustomEventListOrderByField,
  AppObserveEvent,
  AppObserveEventsOrderByDirection,
  AppObserveEventsOrderByField,
} from '../graphql/generated';
import { fetchObserveCustomEventsAsync } from './fetchCustomEvents';
import { fetchObserveEventsAsync, resolveOrderBy } from './fetchEvents';

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

// A syntactically valid UUID that matches no real session, used only to trip
// the server-side session-timeline plan gate without fetching real data.
const SESSION_ACCESS_PROBE_ID = '00000000-0000-0000-0000-000000000000';

/**
 * Issues a throwaway session-scoped query so the server-side session-timeline
 * plan gate fires (or doesn't) up front. Blocked plans reject with the coded
 * plan-gate error; allowed plans get an empty result that is discarded. Used to
 * check access before the interactive session picker runs.
 */
export async function verifyObserveSessionAccessAsync(
  graphqlClient: ExpoGraphqlClient,
  appId: string
): Promise<void> {
  await fetchObserveSessionEventsAsync(graphqlClient, appId, {
    sessionId: SESSION_ACCESS_PROBE_ID,
    limit: 1,
  });
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

/**
 * A metric event that is guaranteed to belong to a session — used as a
 * candidate when picking a session to inspect via `observe:session`.
 */
export type SessionMetricCandidate = AppObserveEvent & { sessionId: string };

export interface FetchSessionMetricCandidatesOptions {
  metricName: string;
  /** One of EventsOrderPreset (case-insensitive). */
  sort: string;
  startTime: string;
  endTime: string;
  limit: number;
}

/**
 * Fetch a page of metric events for the given metricName + window, ordered
 * per `sort`, and filtered to events that have a sessionId. The events query
 * supports server-side ordering, so `sort` is passed straight through.
 */
export async function fetchSessionMetricCandidatesAsync(
  graphqlClient: ExpoGraphqlClient,
  appId: string,
  options: FetchSessionMetricCandidatesOptions
): Promise<SessionMetricCandidate[]> {
  const { events } = await fetchObserveEventsAsync(graphqlClient, appId, {
    metricName: options.metricName,
    orderBy: resolveOrderBy(options.sort),
    limit: options.limit,
    startTime: options.startTime,
    endTime: options.endTime,
  });
  return events.filter((e): e is SessionMetricCandidate => !!e.sessionId);
}

/**
 * A custom log event that is guaranteed to belong to a session — used as a
 * candidate when picking a session to inspect via `observe:session`.
 */
export type SessionLogCandidate = AppObserveCustomEvent & { sessionId: string };

export interface FetchSessionLogCandidatesOptions {
  eventName: string;
  /** True → oldest-first (ascending timestamp); false → newest-first. */
  orderAscending: boolean;
  startTime: string;
  endTime: string;
  limit: number;
}

/**
 * Fetch a page of custom log events for the given eventName + window, ordered
 * by timestamp server-side, and filtered to events that have a sessionId.
 */
export async function fetchSessionLogCandidatesAsync(
  graphqlClient: ExpoGraphqlClient,
  appId: string,
  options: FetchSessionLogCandidatesOptions
): Promise<SessionLogCandidate[]> {
  const { events } = await fetchObserveCustomEventsAsync(graphqlClient, appId, {
    eventName: options.eventName,
    limit: options.limit,
    startTime: options.startTime,
    endTime: options.endTime,
    orderBy: {
      field: AppObserveCustomEventListOrderByField.Timestamp,
      direction: options.orderAscending
        ? AppObserveEventsOrderByDirection.Asc
        : AppObserveEventsOrderByDirection.Desc,
    },
  });
  return events.filter((e): e is SessionLogCandidate => !!e.sessionId);
}
