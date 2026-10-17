import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { DeviceRunSessionStatus, JobRunStatus } from '../graphql/generated';
import { DeviceRunSessionQuery } from '../graphql/queries/DeviceRunSessionQuery';
import Log from '../log';

export class ControlSessionEndedError extends Error {
  constructor(
    sessionId: string,
    readonly failed = false
  ) {
    super(`Simulator session ${sessionId} ${failed ? 'errored' : 'has ended'}.`);
    this.name = 'ControlSessionEndedError';
  }
}

/** Watches status without extending or stopping the remote session. */
export function watchControlSession(
  graphqlClient: ExpoGraphqlClient,
  sessionId: string,
  {
    signal,
    pollIntervalMs = 5000,
    requestTimeoutMs = 30_000,
  }: { signal: AbortSignal; pollIntervalMs?: number; requestTimeoutMs?: number }
): { signal: AbortSignal; dispose(): void } {
  const controller = new AbortController();
  let pollTimer: NodeJS.Timeout | undefined;
  let cancelRequest: (() => void) | undefined;

  function stop(reason?: unknown): void {
    if (controller.signal.aborted) {
      return;
    }
    clearTimeout(pollTimer);
    cancelRequest?.();
    signal.removeEventListener('abort', onAbort);
    controller.abort(reason);
  }

  function onAbort(): void {
    stop(signal.reason);
  }

  function schedulePoll(): void {
    if (!controller.signal.aborted) {
      pollTimer = setTimeout(poll, pollIntervalMs);
    }
  }

  function retry(error: unknown): void {
    Log.debug(`Could not check simulator session ${sessionId}:`, error);
    schedulePoll();
  }

  function poll(): void {
    pollTimer = undefined;
    let subscription: { unsubscribe(): void } | undefined;
    let requestTimer: NodeJS.Timeout | undefined;
    let finished = false;

    function finishRequest(): boolean {
      if (finished) {
        return false;
      }
      finished = true;
      clearTimeout(requestTimer);
      // urql tears down the operation and aborts the HTTP fetch on unsubscribe.
      subscription?.unsubscribe();
      cancelRequest = undefined;
      return true;
    }

    cancelRequest = () => {
      finishRequest();
    };
    requestTimer = setTimeout(() => {
      if (finishRequest()) {
        retry(new Error('Session status request timed out.'));
      }
    }, requestTimeoutMs);

    try {
      subscription = DeviceRunSessionQuery.byId(graphqlClient, sessionId, {
        requestPolicy: 'network-only',
        noRetry: true,
      }).subscribe(result => {
        if (result.stale || result.hasNext || !finishRequest()) {
          return;
        }
        const session = result.data?.deviceRunSessions?.byId;
        if (result.error || !session) {
          retry(result.error ?? new Error('Session status response was empty.'));
          return;
        }
        if (
          [DeviceRunSessionStatus.Stopped, DeviceRunSessionStatus.Errored].includes(
            session.status
          ) ||
          (session.turtleJobRun &&
            [JobRunStatus.Canceled, JobRunStatus.Finished, JobRunStatus.Errored].includes(
              session.turtleJobRun.status
            ))
        ) {
          const failed =
            session.status === DeviceRunSessionStatus.Errored ||
            session.turtleJobRun?.status === JobRunStatus.Errored;
          stop(new ControlSessionEndedError(sessionId, failed));
        } else {
          schedulePoll();
        }
      });
      // A synchronous source may finish before subscribe returns its handle.
      if (finished) {
        subscription.unsubscribe();
      }
    } catch (error) {
      if (finishRequest()) {
        retry(error);
      }
    }
  }

  if (signal.aborted) {
    stop(signal.reason);
  } else {
    signal.addEventListener('abort', onAbort, { once: true });
    schedulePoll();
  }
  return { signal: controller.signal, dispose: stop };
}
