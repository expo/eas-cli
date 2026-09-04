import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import {
  AppObserveError,
  AppObserveLogsOrderByField,
  AppObserveMetric,
  AppObserveMetricsListOrderByField,
  AppObserveOrderDirection,
  AppObserveUserEvent,
  AppObserveUserEventListOrderByField,
} from '../graphql/generated';
import { AppObserveSessionLog, ObserveQuery } from '../graphql/queries/ObserveQuery';
import { fetchObserveCustomEventsAsync } from './fetchCustomEvents';
import { fetchObserveEventsAsync, resolveOrderBy } from './fetchEvents';

export interface SessionEventEntry {
  source: 'metric' | 'log';
  timestamp: string;
  sessionId: string;
  // Metric name, user-event name, or error type.
  name: string;
  appVersion: string;
  appBuildNumber: string;
  appUpdateId: string | null;
  deviceModel: string;
  deviceOs: string;
  deviceOsVersion: string;
  countryCode: string | null;
  easClientId: string;
  // metric-only fields
  value?: number;
  customParams?: { [key: string]: any } | null;
  routeName?: string | null;
  // log-only fields
  severityText?: string | null;
  severityNumber?: number | null;
  properties?: Array<{ key: string; value: string; type: string }>;
  environment?: string | null;
}

function metricEventToEntry(event: AppObserveMetric): SessionEventEntry {
  return {
    source: 'metric',
    timestamp: event.timestamp,
    sessionId: event.sessionId ?? '',
    name: event.name,
    appVersion: event.appVersion,
    appBuildNumber: event.appBuildNumber,
    appUpdateId: event.appUpdateId ?? null,
    deviceModel: event.deviceModel,
    deviceOs: event.deviceOs,
    deviceOsVersion: event.deviceOsVersion,
    countryCode: event.countryCode ?? null,
    easClientId: event.easClientId,
    value: event.value,
    customParams: event.customParams ?? null,
    routeName: event.routeName ?? null,
  };
}

function userEventToEntry(event: AppObserveUserEvent): SessionEventEntry {
  return {
    source: 'log',
    timestamp: event.timestamp,
    sessionId: event.sessionId ?? '',
    name: event.name,
    appVersion: event.appVersion,
    appBuildNumber: event.appBuildNumber,
    appUpdateId: event.appUpdateId ?? null,
    deviceModel: event.deviceModel,
    deviceOs: event.deviceOs,
    deviceOsVersion: event.deviceOsVersion,
    countryCode: event.countryCode ?? null,
    easClientId: event.easClientId,
    severityText: event.severityText ?? null,
    severityNumber: event.severityNumber ?? null,
    properties: event.properties.map(p => ({ key: p.key, value: p.value, type: p.type })),
    environment: event.environment ?? null,
  };
}

function errorToEntry(event: AppObserveError): SessionEventEntry {
  const properties = [
    ...(event.message ? [{ key: 'message', value: event.message, type: 'STRING' }] : []),
    ...event.properties.map(p => ({ key: p.key, value: p.value, type: p.type })),
  ];
  return {
    source: 'log',
    timestamp: event.timestamp,
    sessionId: event.sessionId ?? '',
    name: event.type ?? 'exception',
    appVersion: event.appVersion,
    appBuildNumber: event.appBuildNumber,
    appUpdateId: event.appUpdateId ?? null,
    deviceModel: event.deviceModel,
    deviceOs: event.deviceOs,
    deviceOsVersion: event.deviceOsVersion,
    countryCode: event.countryCode ?? null,
    easClientId: event.easClientId,
    severityText: event.severityText ?? null,
    severityNumber: event.severityNumber ?? null,
    properties,
    environment: event.environment ?? null,
  };
}

function sessionLogToEntry(log: AppObserveSessionLog): SessionEventEntry {
  return log.__typename === 'AppObserveError' ? errorToEntry(log) : userEventToEntry(log);
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
  const { metrics, logs, metricsPageInfo, logsPageInfo } = await ObserveQuery.sessionEventsAsync(
    graphqlClient,
    {
      appId,
      id: options.sessionId,
      first: options.limit,
      metricsOrderBy: {
        field: AppObserveMetricsListOrderByField.Timestamp,
        direction: AppObserveOrderDirection.Asc,
      },
      logsOrderBy: {
        field: AppObserveLogsOrderByField.Timestamp,
        direction: AppObserveOrderDirection.Asc,
      },
    }
  );

  const entries = [...metrics.map(metricEventToEntry), ...logs.map(sessionLogToEntry)].sort(
    (a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0)
  );

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
    hasMoreMetricEvents: metricsPageInfo.hasNextPage,
    hasMoreLogEvents: logsPageInfo.hasNextPage,
  };
}

/**
 * A metric event that is guaranteed to belong to a session — used as a
 * candidate when picking a session to inspect via `observe:session`.
 */
export type SessionMetricCandidate = AppObserveMetric & { sessionId: string };

export interface FetchSessionMetricCandidatesOptions {
  metricName: string;
  /** One of EventsOrderPreset (case-insensitive). */
  sort: string;
  startTime: string;
  endTime: string;
  limit: number;
  environment?: string;
}

/**
 * Fetch a page of metric events for the given metricName + window, ordered
 * per `sort`, and filtered to events that have a sessionId. The metrics query
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
    environment: options.environment,
  });
  return events.filter((e): e is SessionMetricCandidate => !!e.sessionId);
}

/**
 * A user-defined log event that is guaranteed to belong to a session — used as
 * a candidate when picking a session to inspect via `observe:session`.
 */
export type SessionLogCandidate = AppObserveUserEvent & { sessionId: string };

export interface FetchSessionLogCandidatesOptions {
  eventName: string;
  /** True → oldest-first (ascending timestamp); false → newest-first. */
  orderAscending: boolean;
  startTime: string;
  endTime: string;
  limit: number;
  environment?: string;
}

/**
 * Fetch a page of user-defined log events for the given eventName + window,
 * ordered by timestamp server-side, and filtered to events that have a sessionId.
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
    environment: options.environment,
    orderBy: {
      field: AppObserveUserEventListOrderByField.Timestamp,
      direction: options.orderAscending
        ? AppObserveOrderDirection.Asc
        : AppObserveOrderDirection.Desc,
    },
  });
  return events.filter((e): e is SessionLogCandidate => !!e.sessionId);
}
