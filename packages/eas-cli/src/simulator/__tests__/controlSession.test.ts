import { createClient, fetchExchange } from '@urql/core';
import { getEventListeners } from 'node:events';

import { DeviceRunSessionStatus, JobRunStatus } from '../../graphql/generated';
import { DeviceRunSessionQuery } from '../../graphql/queries/DeviceRunSessionQuery';
import Log from '../../log';
import { ControlSessionEndedError, watchControlSession } from '../controlSession';

type SessionStatus = {
  status: DeviceRunSessionStatus;
  turtleJobRun?: { id: string; status: JobRunStatus } | null;
};

type StatusSource = ReturnType<typeof DeviceRunSessionQuery.byId>;
type StatusObserver = Parameters<StatusSource['subscribe']>[0];
type StatusResult = Parameters<StatusObserver>[0];

type StatusRequest = {
  signal: AbortSignal;
  respond: (body: unknown) => void;
  fail: (error: Error) => void;
};

function createStatusClient(): {
  client: ReturnType<typeof createClient>;
  fetch: jest.Mock<
    Promise<Response>,
    [url: Parameters<typeof globalThis.fetch>[0], options?: RequestInit]
  >;
  requests: StatusRequest[];
  activeRequests(): number;
} {
  const requests: StatusRequest[] = [];
  let activeRequests = 0;
  const fetch = jest.fn((_url: Parameters<typeof globalThis.fetch>[0], options?: RequestInit) => {
    const signal = options!.signal!;
    activeRequests++;
    return new Promise<Response>((resolve, reject) => {
      let finished = false;
      const finish = (): boolean => {
        if (finished) {
          return false;
        }
        finished = true;
        activeRequests--;
        signal.removeEventListener('abort', onAbort);
        return true;
      };
      const onAbort = (): void => {
        if (finish()) {
          reject(new Error('Request aborted'));
        }
      };
      signal.addEventListener('abort', onAbort, { once: true });
      requests.push({
        signal,
        respond: body => {
          if (finish()) {
            resolve(
              new Response(JSON.stringify(body), {
                headers: { 'Content-Type': 'application/json' },
              })
            );
          }
        },
        fail: error => {
          if (finish()) {
            reject(error);
          }
        },
      });
    });
  });
  const client = createClient({
    url: 'https://example.test/graphql',
    exchanges: [fetchExchange],
    fetch,
    fetchOptions: () => ({ headers: { authorization: 'Bearer session-token' } }),
  });
  return { client, fetch, requests, activeRequests: () => activeRequests };
}

function sessionResponse(status: SessionStatus): unknown {
  return { data: { deviceRunSessions: { byId: { id: 'session-id', ...status } } } };
}

describe(watchControlSession, () => {
  const disposers: (() => void)[] = [];

  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(Log, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    for (const dispose of disposers.splice(0)) {
      dispose();
    }
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  function watch(
    client: ReturnType<typeof createStatusClient>['client'],
    options: Parameters<typeof watchControlSession>[2] = {
      signal: new AbortController().signal,
    }
  ): ReturnType<typeof watchControlSession> {
    const watcher = watchControlSession(client, 'session-id', options);
    disposers.push(watcher.dispose);
    return watcher;
  }

  it('polls serially after each completed request and preserves authentication', async () => {
    const observed = createStatusClient();
    const query = jest.spyOn(observed.client, 'query');
    watch(observed.client);

    await jest.advanceTimersByTimeAsync(4999);
    expect(observed.fetch).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(observed.fetch).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(
      expect.anything(),
      { deviceRunSessionId: 'session-id' },
      { requestPolicy: 'network-only', noRetry: true }
    );
    expect(observed.fetch.mock.calls[0][1]?.headers).toEqual(
      expect.objectContaining({ authorization: 'Bearer session-token' })
    );
    await jest.advanceTimersByTimeAsync(5000);
    expect(observed.fetch).toHaveBeenCalledTimes(1);
    expect(observed.activeRequests()).toBe(1);

    observed.requests[0].respond(sessionResponse({ status: DeviceRunSessionStatus.InProgress }));
    await jest.advanceTimersByTimeAsync(0);
    await jest.advanceTimersByTimeAsync(4999);
    expect(observed.fetch).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(observed.fetch).toHaveBeenCalledTimes(2);
    expect(observed.activeRequests()).toBe(1);
  });

  it.each([DeviceRunSessionStatus.Stopped, DeviceRunSessionStatus.Errored])(
    'ends control when an idle session becomes %s',
    async status => {
      const observed = createStatusClient();
      const watcher = watch(observed.client);
      await jest.advanceTimersByTimeAsync(5000);
      observed.requests[0].respond(sessionResponse({ status }));
      await jest.advanceTimersByTimeAsync(0);

      expect(watcher.signal.aborted).toBe(true);
      expect(watcher.signal.reason).toBeInstanceOf(ControlSessionEndedError);
      expect(watcher.signal.reason.message).toContain('session-id');
      expect(watcher.signal.reason.failed).toBe(status === DeviceRunSessionStatus.Errored);
      expect(jest.getTimerCount()).toBe(0);
      await jest.advanceTimersByTimeAsync(60_000);
      expect(observed.fetch).toHaveBeenCalledTimes(1);
    }
  );

  it.each([JobRunStatus.Canceled, JobRunStatus.Finished, JobRunStatus.Errored])(
    'ends control when the worker job becomes %s before the session status catches up',
    async status => {
      const observed = createStatusClient();
      const watcher = watch(observed.client);
      await jest.advanceTimersByTimeAsync(5000);
      observed.requests[0].respond(
        sessionResponse({
          status: DeviceRunSessionStatus.InProgress,
          turtleJobRun: { id: 'job-id', status },
        })
      );
      await jest.advanceTimersByTimeAsync(0);

      expect(watcher.signal.reason).toBeInstanceOf(ControlSessionEndedError);
      expect(watcher.signal.reason.failed).toBe(status === JobRunStatus.Errored);
      expect(jest.getTimerCount()).toBe(0);
    }
  );

  it('keeps watching a session without a job and a job whose cancellation is pending', async () => {
    const observed = createStatusClient();
    const watcher = watch(observed.client);
    await jest.advanceTimersByTimeAsync(5000);
    observed.requests[0].respond(
      sessionResponse({ status: DeviceRunSessionStatus.InProgress, turtleJobRun: null })
    );
    await jest.advanceTimersByTimeAsync(5000);
    observed.requests[1].respond(
      sessionResponse({
        status: DeviceRunSessionStatus.InProgress,
        turtleJobRun: { id: 'job-id', status: JobRunStatus.PendingCancel },
      })
    );
    await jest.advanceTimersByTimeAsync(0);

    expect(watcher.signal.aborted).toBe(false);
    expect(jest.getTimerCount()).toBe(1);
  });

  it('logs network and GraphQL failures, then retries without ending control', async () => {
    const observed = createStatusClient();
    const watcher = watch(observed.client);
    await jest.advanceTimersByTimeAsync(5000);
    observed.requests[0].fail(new Error('Connection reset'));
    await jest.advanceTimersByTimeAsync(5000);
    observed.requests[1].respond({ errors: [{ message: 'Temporarily unavailable' }] });
    await jest.advanceTimersByTimeAsync(5000);

    expect(watcher.signal.aborted).toBe(false);
    expect(Log.debug).toHaveBeenCalledTimes(2);
    expect(observed.activeRequests()).toBe(1);
    observed.requests[2].respond(sessionResponse({ status: DeviceRunSessionStatus.Stopped }));
    await jest.advanceTimersByTimeAsync(0);
    expect(watcher.signal.reason).toBeInstanceOf(ControlSessionEndedError);
  });

  it.each([
    { data: {} },
    { data: { deviceRunSessions: null } },
    { data: { deviceRunSessions: { byId: null } } },
  ])('retries an empty session response %j without treating it as ended', async body => {
    const observed = createStatusClient();
    const watcher = watch(observed.client);
    await jest.advanceTimersByTimeAsync(5000);
    observed.requests[0].respond(body);
    await jest.advanceTimersByTimeAsync(0);

    expect(watcher.signal.aborted).toBe(false);
    expect(Log.debug).toHaveBeenCalledWith(
      expect.stringContaining('session-id'),
      expect.objectContaining({ message: 'Session status response was empty.' })
    );
    expect(jest.getTimerCount()).toBe(1);
    await jest.advanceTimersByTimeAsync(5000);
    expect(observed.fetch).toHaveBeenCalledTimes(2);
    observed.requests[1].respond(sessionResponse({ status: DeviceRunSessionStatus.Stopped }));
    await jest.advanceTimersByTimeAsync(0);
    expect(watcher.signal.reason).toBeInstanceOf(ControlSessionEndedError);
  });

  it('waits for a successful response when GraphQL returns partial terminal data with an error', async () => {
    const observed = createStatusClient();
    const watcher = watch(observed.client);
    await jest.advanceTimersByTimeAsync(5000);
    observed.requests[0].respond({
      ...(sessionResponse({ status: DeviceRunSessionStatus.Stopped }) as object),
      errors: [{ message: 'Status temporarily unavailable', extensions: { isTransient: true } }],
    });
    await jest.advanceTimersByTimeAsync(0);

    expect(watcher.signal.aborted).toBe(false);
    expect(Log.debug).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(5000);
    observed.requests[1].respond(sessionResponse({ status: DeviceRunSessionStatus.InProgress }));
    await jest.advanceTimersByTimeAsync(0);
    expect(watcher.signal.aborted).toBe(false);
    expect(jest.getTimerCount()).toBe(1);
  });

  it('ignores stale and incomplete terminal results until the source confirms a final result', async () => {
    const observed = createStatusClient();
    const unsubscribe = jest.fn();
    let emit: StatusObserver | undefined;
    const subscribe = jest.fn((next: StatusObserver) => {
      emit = next;
      return { unsubscribe };
    });
    jest
      .spyOn(DeviceRunSessionQuery, 'byId')
      .mockReturnValue({ subscribe } as unknown as StatusSource);
    const watcher = watch(observed.client);
    await jest.advanceTimersByTimeAsync(5000);
    const terminal = sessionResponse({ status: DeviceRunSessionStatus.Stopped }) as StatusResult;
    emit!({ ...terminal, stale: true, hasNext: false });
    emit!({ ...terminal, stale: false, hasNext: true });
    await jest.advanceTimersByTimeAsync(5000);

    expect(watcher.signal.aborted).toBe(false);
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(unsubscribe).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(1);
    emit!({ ...terminal, stale: false, hasNext: false });
    expect(watcher.signal.reason).toBeInstanceOf(ControlSessionEndedError);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
    expect(Log.debug).not.toHaveBeenCalled();
  });

  it.each([DeviceRunSessionStatus.InProgress, DeviceRunSessionStatus.Stopped])(
    'unsubscribes a synchronously emitted %s response after subscribe returns its handle',
    async status => {
      const observed = createStatusClient();
      const unsubscribe = jest.fn();
      const subscribe = jest.fn((next: StatusObserver) => {
        next({ ...(sessionResponse({ status }) as StatusResult), stale: false, hasNext: false });
        return { unsubscribe };
      });
      jest
        .spyOn(DeviceRunSessionQuery, 'byId')
        .mockReturnValue({ subscribe } as unknown as StatusSource);
      const controller = new AbortController();
      const watcher = watch(observed.client, { signal: controller.signal });
      await jest.advanceTimersByTimeAsync(5000);

      expect(unsubscribe).toHaveBeenCalledTimes(1);
      expect(watcher.signal.aborted).toBe(status === DeviceRunSessionStatus.Stopped);
      expect(jest.getTimerCount()).toBe(status === DeviceRunSessionStatus.Stopped ? 0 : 1);
      watcher.dispose();
      expect(unsubscribe).toHaveBeenCalledTimes(1);
      expect(jest.getTimerCount()).toBe(0);
      expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
      expect(observed.fetch).not.toHaveBeenCalled();
    }
  );

  it('recovers from a synchronous query setup failure without leaving its deadline running', async () => {
    const observed = createStatusClient();
    const failure = new Error('Could not initialize status request');
    jest.spyOn(DeviceRunSessionQuery, 'byId').mockImplementationOnce(() => {
      throw failure;
    });
    const watcher = watch(observed.client);
    await jest.advanceTimersByTimeAsync(5000);

    expect(watcher.signal.aborted).toBe(false);
    expect(Log.debug).toHaveBeenCalledWith(expect.stringContaining('session-id'), failure);
    expect(jest.getTimerCount()).toBe(1);
    expect(observed.fetch).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(5000);
    expect(observed.fetch).toHaveBeenCalledTimes(1);
    observed.requests[0].respond(sessionResponse({ status: DeviceRunSessionStatus.InProgress }));
    await jest.advanceTimersByTimeAsync(0);
    expect(jest.getTimerCount()).toBe(1);
  });

  it('unsubscribes and aborts the fetch at the request deadline before retrying', async () => {
    const observed = createStatusClient();
    const watcher = watch(observed.client, {
      signal: new AbortController().signal,
      pollIntervalMs: 100,
      requestTimeoutMs: 200,
    });
    await jest.advanceTimersByTimeAsync(100);
    expect(observed.activeRequests()).toBe(1);
    await jest.advanceTimersByTimeAsync(199);
    expect(observed.requests[0].signal.aborted).toBe(false);
    await jest.advanceTimersByTimeAsync(1);

    expect(observed.requests[0].signal.aborted).toBe(true);
    expect(observed.activeRequests()).toBe(0);
    expect(watcher.signal.aborted).toBe(false);
    expect(Log.debug).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(100);
    expect(observed.fetch).toHaveBeenCalledTimes(2);
    expect(observed.activeRequests()).toBe(1);
  });

  it('disposes an in-flight fetch and all timers without sending a stop mutation', async () => {
    const observed = createStatusClient();
    const mutation = jest.spyOn(observed.client, 'mutation');
    const watcher = watch(observed.client);
    await jest.advanceTimersByTimeAsync(5000);
    watcher.dispose();
    watcher.dispose();

    expect(observed.requests[0].signal.aborted).toBe(true);
    expect(observed.activeRequests()).toBe(0);
    expect(watcher.signal.aborted).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(observed.fetch).toHaveBeenCalledTimes(1);
    expect(mutation).not.toHaveBeenCalled();
  });

  it('propagates parent cancellation and tears down an in-flight request', async () => {
    const observed = createStatusClient();
    const controller = new AbortController();
    const watcher = watch(observed.client, { signal: controller.signal });
    await jest.advanceTimersByTimeAsync(5000);
    const reason = new Error('Control connection lost');
    controller.abort(reason);

    expect(watcher.signal.reason).toBe(reason);
    expect(observed.requests[0].signal.aborted).toBe(true);
    expect(observed.activeRequests()).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
    expect(Log.debug).not.toHaveBeenCalled();
  });

  it('clears an idle poll and never polls an already canceled parent', async () => {
    const observed = createStatusClient();
    const controller = new AbortController();
    const watcher = watch(observed.client, { signal: controller.signal });
    controller.abort();
    expect(watcher.signal.reason).toBe(controller.signal.reason);
    expect(jest.getTimerCount()).toBe(0);
    const alreadyCanceled = watch(observed.client, { signal: controller.signal });
    expect(alreadyCanceled.signal.reason).toBe(controller.signal.reason);
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(observed.fetch).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('disposes an idle retry and removes its parent listener before the next poll', async () => {
    const observed = createStatusClient();
    const controller = new AbortController();
    const watcher = watch(observed.client, { signal: controller.signal });
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(5000);
    observed.requests[0].fail(new Error('Connection reset'));
    await jest.advanceTimersByTimeAsync(0);
    expect(jest.getTimerCount()).toBe(1);
    watcher.dispose();

    expect(watcher.signal.aborted).toBe(true);
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
    expect(jest.getTimerCount()).toBe(0);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(observed.fetch).toHaveBeenCalledTimes(1);
  });

  it('preserves the existing byIdAsync result and default query context', async () => {
    const observed = createStatusClient();
    const query = jest.spyOn(observed.client, 'query');
    const result = DeviceRunSessionQuery.byIdAsync(observed.client, 'session-id');
    await jest.advanceTimersByTimeAsync(0);
    observed.requests[0].respond(sessionResponse({ status: DeviceRunSessionStatus.InProgress }));

    await expect(result).resolves.toEqual({
      id: 'session-id',
      status: DeviceRunSessionStatus.InProgress,
    });
    expect(query).toHaveBeenCalledWith(
      expect.anything(),
      { deviceRunSessionId: 'session-id' },
      { requestPolicy: 'network-only' }
    );
  });

  it('preserves byIdAsync rejection for a GraphQL error', async () => {
    const observed = createStatusClient();
    const result = DeviceRunSessionQuery.byIdAsync(observed.client, 'session-id');
    const rejected = expect(result).rejects.toThrow('Permission denied');
    await jest.advanceTimersByTimeAsync(0);
    observed.requests[0].respond({ errors: [{ message: 'Permission denied' }] });
    await rejected;
  });
});
