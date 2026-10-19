import { type bunyan } from '@expo/logger';

const POLL_INTERVAL_MS = 5_000;
const REQUEST_TIMEOUT_MS = 5_000;

export type ServeSimActivityPolling = {
  /**
   * When a new event log entry (input or host action, not stream traffic) was first seen. Reports
   * now while the log is unreadable but serve-sim is up, so an unobservable session stays active.
   */
  getLastActivityObservedAt: () => Date | undefined;
  stopAsync: () => Promise<void>;
};

/** Nothing listens on the port. A reset or dropped response can come from a running serve-sim. */
function isServeSimDownError(err: unknown): boolean {
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

/** A changed newest event ID counts as activity, timed by the local clock. */
export function startServeSimActivityPolling({
  port,
  token,
  logger,
  pollIntervalMs = POLL_INTERVAL_MS,
}: {
  port: number;
  token: string;
  logger: bunyan;
  pollIntervalMs?: number;
}): ServeSimActivityPolling {
  const controller = new AbortController();
  let lastEventId: number | undefined;
  let lastActivityObservedAt: Date | undefined;
  let eventLogUnavailable = false;
  let didWarn = false;
  let timer: NodeJS.Timeout | undefined;
  let pending: Promise<void> = Promise.resolve();

  const pollAsync = async (): Promise<void> => {
    try {
      const eventId = await fetchLatestServeSimEventIdAsync({
        port,
        token,
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
      });
      eventLogUnavailable = false;
      if (eventId !== undefined && eventId !== lastEventId) {
        lastEventId = eventId;
        lastActivityObservedAt = new Date();
      }
    } catch (err) {
      if (controller.signal.aborted) {
        return;
      }
      // Only a down serve-sim, which receives no input either, keeps the last observation.
      eventLogUnavailable = !isServeSimDownError(err);
      if (!didWarn) {
        didWarn = true;
        logger.warn(
          { err },
          eventLogUnavailable
            ? 'Could not read the serve-sim event log. Preview input cannot be observed, so the ' +
                'idle timeout does not stop this session.'
            : 'Could not read serve-sim preview activity.'
        );
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

export async function fetchLatestServeSimEventIdAsync({
  port,
  token,
  signal,
}: {
  port: number;
  token: string;
  signal?: AbortSignal;
}): Promise<number | undefined> {
  const response = await fetch(`http://127.0.0.1:${port}/api/event-log?limit=1`, {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`serve-sim event log request failed: ${response.status}`);
  }
  const text = await response.text();
  let body: { events?: unknown } | undefined;
  try {
    body = JSON.parse(text);
  } catch {}
  if (!Array.isArray(body?.events)) {
    throw new Error('serve-sim event log response has no events array.');
  }
  if (body.events.length === 0) {
    return undefined;
  }
  const id = (body.events.at(-1) as { id?: unknown } | null)?.id;
  if (typeof id !== 'number') {
    throw new Error('serve-sim event log entry has no numeric ID.');
  }
  return id;
}
