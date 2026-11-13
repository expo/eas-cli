import { type bunyan } from '@expo/logger';

const POLL_INTERVAL_MS = 5_000;
const REQUEST_TIMEOUT_MS = 5_000;
// expo-device-hub serves serve-emu, which records Android preview input, under this prefix.
const EXPO_DEVICE_HUB_SERVE_EMU_PREFIX = '/vendor/serve-emu';

/** The preview server whose input log counts as session activity. */
export type PreviewActivityServer = 'serve-sim' | 'expo-device-hub';

export type PreviewActivityPolling = {
  /**
   * When a new input log entry (input or host action, not stream traffic) was first seen. Reports
   * now while a read fails for a reason other than a refused connection or a device-unavailable
   * answer, so an unobservable session stays active.
   */
  getLastActivityObservedAt: () => Date | undefined;
  stopAsync: () => Promise<void>;
};

/** What one read of the server's input log shows. */
export type PreviewInputLogState = {
  /** The newest entry's ID, or undefined when the log is empty. */
  latestEventId: number | undefined;
  /**
   * When the server logged the newest entry. A new recording starts its IDs again at 1, so the ID
   * alone can repeat for new input.
   */
  latestEventAt: string | undefined;
  /** The server is replaying recorded input, which it does not log again. */
  replaying: boolean;
  /**
   * When the latest replay started, kept after it ends, so a replay that runs entirely between two
   * reads still shows up as a change.
   */
  replayStartedAt: string | undefined;
};

type ReadInputLogAsync = (options: {
  port: number;
  token: string;
  signal?: AbortSignal;
}) => Promise<PreviewInputLogState>;

const READ_INPUT_LOG: Record<PreviewActivityServer, ReadInputLogAsync> = {
  'serve-sim': readServeSimInputLogAsync,
  'expo-device-hub': readExpoDeviceHubInputLogAsync,
};

/**
 * The server is up but has no device to take input, such as an offline emulator. Like a down
 * server, it receives no input, so the last observation stands.
 */
class PreviewDeviceUnavailableError extends Error {}

/** Nothing listens on the port. A reset or dropped response can come from a running server. */
function isServerDownError(err: unknown): boolean {
  if (err instanceof PreviewDeviceUnavailableError) {
    return true;
  }
  // Not `instanceof`: undici errors can come from another realm.
  let error: unknown = err;
  for (let depth = 0; depth < 5 && typeof error === 'object' && error !== null; depth++) {
    const { code, cause } = error as { code?: unknown; cause?: unknown };
    if (code === 'ECONNREFUSED') {
      return true;
    }
    error = cause;
  }
  return false;
}

/**
 * A changed newest event ID, a new replay, or a running replay counts as activity, timed by the
 * local clock.
 */
export function startPreviewActivityPolling({
  server,
  port,
  token,
  logger,
  pollIntervalMs = POLL_INTERVAL_MS,
  requestTimeoutMs = REQUEST_TIMEOUT_MS,
}: {
  server: PreviewActivityServer;
  port: number;
  token: string;
  logger: bunyan;
  pollIntervalMs?: number;
  requestTimeoutMs?: number;
}): PreviewActivityPolling {
  const readInputLogAsync = READ_INPUT_LOG[server];
  const controller = new AbortController();
  let lastEventKey: string | undefined;
  let lastReplayStartedAt: string | undefined;
  let lastActivityObservedAt: Date | undefined;
  let eventLogUnavailable = false;
  let didWarnUnavailable = false;
  let didWarnDown = false;
  let timer: NodeJS.Timeout | undefined;
  let pending: Promise<void> = Promise.resolve();

  const pollAsync = async (): Promise<void> => {
    try {
      const { latestEventId, latestEventAt, replaying, replayStartedAt } = await readInputLogAsync({
        port,
        token,
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(requestTimeoutMs)]),
      });
      eventLogUnavailable = false;
      const eventKey =
        latestEventId === undefined ? undefined : `${latestEventId}@${latestEventAt ?? ''}`;
      if (eventKey !== undefined && eventKey !== lastEventKey) {
        lastActivityObservedAt = new Date();
      }
      lastEventKey = eventKey;
      if (replayStartedAt !== undefined && replayStartedAt !== lastReplayStartedAt) {
        lastReplayStartedAt = replayStartedAt;
        lastActivityObservedAt = new Date();
      }
      if (replaying) {
        lastActivityObservedAt = new Date();
      }
    } catch (err) {
      if (controller.signal.aborted) {
        return;
      }
      // Only a down server or device, which receives no input either, keeps the last observation.
      // A timeout proves neither: expo-device-hub holds the read while it changes the capture
      // source, and the open preview keeps taking input meanwhile.
      eventLogUnavailable = !isServerDownError(err);
      if (eventLogUnavailable && !didWarnUnavailable) {
        didWarnUnavailable = true;
        logger.warn(
          { err },
          `Could not read the ${server} input log. Preview input cannot be observed, so the ` +
            'idle timeout does not stop this session while the log cannot be read.'
        );
      } else if (!eventLogUnavailable && !didWarnDown) {
        didWarnDown = true;
        logger.warn({ err }, `Could not read ${server} preview activity.`);
      }
    }
  };
  const tick = (): void => {
    pending = pollAsync().finally(() => {
      if (!controller.signal.aborted) {
        timer = setTimeout(tick, pollIntervalMs);
        timer.unref();
      }
    });
  };
  tick();
  return {
    getLastActivityObservedAt: () => (eventLogUnavailable ? new Date() : lastActivityObservedAt),
    stopAsync: async () => {
      controller.abort();
      clearTimeout(timer);
      await pending;
    },
  };
}

export async function readServeSimInputLogAsync({
  port,
  token,
  signal,
}: {
  port: number;
  token: string;
  signal?: AbortSignal;
}): Promise<PreviewInputLogState> {
  return await readInputLogAsync({
    url: `http://127.0.0.1:${port}/api/event-log?limit=1`,
    token,
    signal,
    logName: 'serve-sim event log',
  });
}

/**
 * Reads serve-emu's session recording through expo-device-hub. It records browser preview and REST
 * input: touches, keys, text, navigation buttons, and location. It does not record input sent with
 * `record: false` (the preview's Reload button) or actions such as rotation and screenshots, so
 * those alone do not keep a session active. Controller commands count through the session's own
 * event stream. The hub scopes the request to its single device.
 */
export async function readExpoDeviceHubInputLogAsync({
  port,
  token,
  signal,
}: {
  port: number;
  token: string;
  signal?: AbortSignal;
}): Promise<PreviewInputLogState> {
  return await readInputLogAsync({
    // The hub returns the whole recording and ignores `limit`; serve-emu's paged route honors it.
    url: `http://127.0.0.1:${port}${EXPO_DEVICE_HUB_SERVE_EMU_PREFIX}/api/session?limit=1`,
    token,
    signal,
    logName: 'expo-device-hub input log',
    // The hub answers 503 while it cannot reach the emulator.
    deviceUnavailableStatus: 503,
  });
}

async function readInputLogAsync({
  url,
  token,
  signal,
  logName,
  deviceUnavailableStatus,
}: {
  url: string;
  token: string;
  signal?: AbortSignal;
  logName: string;
  deviceUnavailableStatus?: number;
}): Promise<PreviewInputLogState> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  });
  if (!response.ok) {
    await response.body?.cancel();
    const message = `${logName} request failed: ${response.status}`;
    throw response.status === deviceUnavailableStatus
      ? new PreviewDeviceUnavailableError(message)
      : new Error(message);
  }
  const text = await response.text();
  type ReplayState = { replaying?: unknown; replayStartedAt?: unknown };
  // The hub route returns the recorder snapshot; serve-emu's paged route nests it under `session`.
  let body: ({ events?: unknown; session?: ReplayState } & ReplayState) | undefined;
  try {
    body = JSON.parse(text);
  } catch {}
  if (!Array.isArray(body?.events)) {
    throw new Error(`${logName} response has no events array.`);
  }
  const replayState: ReplayState = body.session ?? body;
  const replaying = replayState.replaying === true;
  const replayStartedAt =
    typeof replayState.replayStartedAt === 'string' ? replayState.replayStartedAt : undefined;
  if (body.events.length === 0) {
    return { latestEventId: undefined, latestEventAt: undefined, replaying, replayStartedAt };
  }
  const latest = body.events.at(-1) as { id?: unknown; at?: unknown; timestamp?: unknown } | null;
  if (typeof latest?.id !== 'number') {
    throw new Error(`${logName} entry has no numeric ID.`);
  }
  // serve-emu names the time `at`; serve-sim names it `timestamp`.
  const at = latest.at ?? latest.timestamp;
  return {
    latestEventId: latest.id,
    latestEventAt: typeof at === 'string' ? at : undefined,
    replaying,
    replayStartedAt,
  };
}
