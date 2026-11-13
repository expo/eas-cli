import { SystemError } from '@expo/eas-build-job';
import { type bunyan } from '@expo/logger';
import * as ngrok from '@ngrok/ngrok';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { type AddressInfo, type Socket, createConnection, createServer } from 'node:net';
import { clearTimeout, setTimeout } from 'node:timers';

import { turtleFetch } from '../../utils/turtleFetch';
import { withDeviceRunSessionTimeoutAsync } from './deviceRunSessionTimeout';

const PROBE_INTERVAL_MS = 15_000;
const FAILURE_THRESHOLD = 3;
const STOP_TIMEOUT_MS = 4_000;
const OPEN_TIMEOUT_MS = 15_000;
// @ngrok/ngrok runs one open at a time, so nothing can open again until a timed-out open
// settles. The first open waits longer instead, and keeps a listener that arrives late. Retries
// use OPEN_TIMEOUT_MS, so all attempts fit in the 60-second preview opening bound.
const FIRST_OPEN_TIMEOUT_MS = 19_000;
const INITIAL_OPEN_ATTEMPTS = 3;
const INITIAL_OPEN_RETRY_DELAY_MS = 1_000;
/** ngrok error codes for failed control-plane requests that can succeed on a retry. */
const RETRYABLE_NGROK_ERROR_CODES = new Set(['ERR_NGROK_802']);

export type NgrokTunnelHandle = {
  url: string;
  subdomainId: string;
  /**
   * Stops the tunnel. The local proxy drops every connection at once; then the listeners close.
   * Rejects when the listeners do not close within the stop time-out.
   */
  stopAsync: () => Promise<void>;
};

export async function startNgrokTunnelAsync({
  port,
  subdomainPrefix,
  subdomainId = randomBytes(16).toString('hex'),
  baseDomain,
  authtoken,
  rewriteHostHeader,
  healthCheck,
  logger,
  signal: startupSignal,
  retrySignal,
}: {
  port: number;
  subdomainPrefix: string;
  subdomainId?: string;
  baseDomain: string;
  authtoken: string;
  rewriteHostHeader?: boolean;
  healthCheck?: { path: string; statuses?: number[] };
  logger: bunyan;
  /** Cancels startup, including retries of the first open. It has no effect after startup. */
  signal?: AbortSignal;
  /**
   * Stops new attempts of the first open without cancelling the attempt in progress, so the
   * caller can still wait for that attempt and close its listener. The first attempt always starts.
   */
  retrySignal?: AbortSignal;
}): Promise<NgrokTunnelHandle> {
  startupSignal?.throwIfAborted();
  const domain = `${subdomainPrefix}-${subdomainId}.${baseDomain}`;
  const controller = new AbortController();
  const { signal } = controller;
  const sockets = new Set<Socket>();
  const target = createServer({ allowHalfOpen: true }, client => {
    if (signal.aborted) {
      client.destroy();
      return;
    }
    const upstream = createConnection({ host: '127.0.0.1', port, allowHalfOpen: true });
    for (const socket of [client, upstream]) {
      sockets.add(socket);
      socket.on('error', () => {
        client.destroy();
        upstream.destroy();
      });
      socket.on('close', () => sockets.delete(socket));
    }
    client.pipe(upstream).pipe(client);
  });
  target.listen(0, '127.0.0.1');
  await once(target, 'listening');
  target.unref();
  signal.addEventListener(
    'abort',
    () => {
      for (const socket of sockets) {
        socket.destroy();
      }
    },
    { once: true }
  );
  const config: ngrok.Config = {
    addr: (target.address() as AddressInfo).port,
    authtoken,
    domain,
    ...(rewriteHostHeader ? { request_header_add: [`Host:localhost:${port}`] } : {}),
  };

  const ownedListeners = new Set<ngrok.Listener>();
  const retiredListeners = new Set<ngrok.Listener>();
  const closingListeners = new Map<ngrok.Listener, Promise<void>>();
  let pendingOpen: Promise<ngrok.Listener> | undefined;
  let currentListener: ngrok.Listener | undefined;
  function releaseTarget(): void {
    if (signal.aborted && !pendingOpen && ownedListeners.size === 0 && target.listening) {
      target.close();
    }
  }

  async function closeAsync(
    listener: ngrok.Listener,
    closeSignal: AbortSignal,
    logFailure = true
  ): Promise<void> {
    retiredListeners.add(listener);
    let closing = closingListeners.get(listener);
    if (!closing) {
      closing = Promise.resolve().then(async () => await listener.close());
      closingListeners.set(listener, closing);
      void closing.then(
        () => {
          closingListeners.delete(listener);
          retiredListeners.delete(listener);
          ownedListeners.delete(listener);
          releaseTarget();
        },
        () => closingListeners.delete(listener)
      );
    }
    try {
      await withDeviceRunSessionTimeoutAsync(
        { name: 'Ngrok tunnel close', timeoutMs: 5_000, signal: closeSignal },
        async () => await closing
      );
    } catch (err) {
      if (logFailure && !closeSignal.aborted) {
        logger.warn({ err }, `Could not stop ngrok tunnel ${domain}.`);
      }
    }
  }

  async function retireListenersAsync(retirementSignal: AbortSignal): Promise<void> {
    let logFailure = true;
    while (retiredListeners.size > 0) {
      retirementSignal.throwIfAborted();
      await Promise.all(
        [...retiredListeners].map(retired => closeAsync(retired, retirementSignal, logFailure))
      );
      logFailure = false;
      if (retiredListeners.size > 0) {
        await waitAsync(250, retirementSignal);
      }
    }
  }

  async function retireLateListenerAsync(listener: ngrok.Listener): Promise<void> {
    retiredListeners.add(listener);
    try {
      await withDeviceRunSessionTimeoutAsync(
        { name: 'Late ngrok tunnel retirement', timeoutMs: STOP_TIMEOUT_MS },
        async retirementSignal => {
          while (retiredListeners.has(listener)) {
            retirementSignal.throwIfAborted();
            await closeAsync(listener, retirementSignal, false);
            if (retiredListeners.has(listener)) {
              await waitAsync(250, retirementSignal);
            }
          }
        }
      );
    } catch (err) {
      logger.warn({ err }, `Could not retire late ngrok tunnel ${domain}.`);
    }
  }

  /**
   * No open is queued behind a pending one: @ngrok/ngrok runs every forward behind one
   * process-wide lock, so a new open cannot start until the pending one settles.
   */
  async function openAsync({
    forceNewSession = false,
    timeoutMs = OPEN_TIMEOUT_MS,
  }: { forceNewSession?: boolean; timeoutMs?: number } = {}): Promise<ngrok.Listener> {
    if (pendingOpen) {
      throw new SystemError(`A previous ngrok tunnel open for ${domain} is still pending.`);
    }
    const startedAt = Date.now();
    let acquired: ngrok.Listener | undefined;
    let retirement: Promise<void> | undefined;
    const retireAcquired = () => {
      if (acquired) {
        retirement ??= retireLateListenerAsync(acquired);
      }
    };
    try {
      return await withDeviceRunSessionTimeoutAsync(
        { name: 'Ngrok tunnel open', timeoutMs, signal },
        async openSignal => {
          openSignal.throwIfAborted();
          const opening = ngrok
            .forward({
              ...config,
              ...(forceNewSession ? { force_new_session: true } : {}),
            })
            .then(listener => {
              acquired = listener;
              ownedListeners.add(listener);
              return listener;
            })
            .finally(() => {
              pendingOpen = undefined;
            });
          pendingOpen = opening;
          // Records how long a timed-out or cancelled open takes to settle, to tune the time-out.
          const logLateSettlement = (outcome: 'opened' | 'failed', err?: unknown) => {
            const elapsedMs = Date.now() - startedAt;
            logger.info(
              { err, outcome, elapsedMs },
              `ngrok tunnel open for ${domain} ${outcome} after ${elapsedMs} ms, after it timed out or was cancelled.`
            );
          };
          void opening.then(
            () => {
              if (openSignal.aborted) {
                logLateSettlement('opened');
                retireAcquired();
              }
            },
            err => {
              if (openSignal.aborted) {
                logLateSettlement('failed', err);
              }
              releaseTarget();
            }
          );
          const listener = await opening;
          openSignal.throwIfAborted();
          return listener;
        }
      );
    } catch (err) {
      retireAcquired();
      throw err;
    }
  }

  // ngrok sometimes rejects an open because a control-plane request failed (for example
  // ERR_NGROK_802), so a rejected first open is retried before the session fails. A timed-out
  // open is not retried: it still holds the ngrok lock, so a retry would only wait behind it.
  async function openInitialAsync(): Promise<ngrok.Listener> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await openAsync({
          // ERR_NGROK_802 is a server error while the endpoint binds on the shared agent session,
          // so a retry connects a new session, which can reach a different ngrok server.
          // @ngrok/ngrok 1.7.0 replaces its shared session but does not close the old one: the old
          // session and its listeners stay connected until the process exits.
          forceNewSession: attempt > 1,
          timeoutMs: attempt === 1 ? FIRST_OPEN_TIMEOUT_MS : OPEN_TIMEOUT_MS,
        });
      } catch (err) {
        // A cancelled startup fails with the caller's reason, so the caller can tell it from an error.
        signal.throwIfAborted();
        if (
          attempt >= INITIAL_OPEN_ATTEMPTS ||
          !isRetryableNgrokError(err) ||
          retrySignal?.aborted
        ) {
          throw err;
        }
        logger.warn(
          { err, attempt },
          `Could not open ngrok tunnel ${domain} (attempt ${attempt} of ${INITIAL_OPEN_ATTEMPTS}); retrying.`
        );
        await waitAsync(
          INITIAL_OPEN_RETRY_DELAY_MS * attempt,
          retrySignal ? AbortSignal.any([signal, retrySignal]) : signal
        );
        signal.throwIfAborted();
        if (retrySignal?.aborted) {
          throw err;
        }
      }
    }
  }

  // Added after the target listens, so the finally below always removes it.
  const abortStartup = () => controller.abort(startupSignal?.reason);
  startupSignal?.addEventListener('abort', abortStartup, { once: true });
  if (startupSignal?.aborted) {
    abortStartup();
  }
  logger.info(`Starting ngrok tunnel ${domain} -> http://localhost:${port}.`);
  let publicUrl: string | null;
  try {
    currentListener = await openInitialAsync();
    publicUrl = currentListener.url();
    if (!publicUrl) {
      await closeAsync(currentListener, signal);
      currentListener = undefined;
      throw new SystemError(`ngrok tunnel for ${domain} did not return a public URL.`);
    }
  } catch (error) {
    controller.abort();
    releaseTarget();
    throw error;
  } finally {
    startupSignal?.removeEventListener('abort', abortStartup);
  }

  const url = publicUrl;

  async function probeAsync(
    baseUrl: string,
    { path, statuses = [200] }: NonNullable<typeof healthCheck>
  ): Promise<boolean> {
    try {
      return await withDeviceRunSessionTimeoutAsync(
        { name: 'Ngrok tunnel health probe', timeoutMs: 5_000, signal },
        async probeSignal => {
          const requestController = new AbortController();
          try {
            const response = await turtleFetch(new URL(path, baseUrl).href, 'GET', {
              retries: 0,
              redirect: 'manual',
              shouldThrowOnNotOk: false,
              headers: { 'ngrok-skip-browser-warning': 'true', 'Cache-Control': 'no-cache' },
              signal: AbortSignal.any([probeSignal, requestController.signal]),
            });
            return !response.headers.has('ngrok-error-code') && statuses.includes(response.status);
          } finally {
            requestController.abort();
          }
        }
      );
    } catch {
      return false;
    }
  }

  async function superviseAsync(check: NonNullable<typeof healthCheck>): Promise<void> {
    let failures = 0;
    let attempts = 0;
    let localUnhealthy = false;
    while (
      await waitAsync(
        currentListener || localUnhealthy
          ? PROBE_INTERVAL_MS
          : Math.min(1_000 * 2 ** Math.min(attempts, 5), 30_000),
        signal
      )
    ) {
      await Promise.all([...retiredListeners].map(retired => closeAsync(retired, signal, false)));
      if (signal.aborted) {
        return;
      }
      if (currentListener && (await probeAsync(url, check))) {
        if (failures > 0 || attempts > 0 || localUnhealthy) {
          logger.info(`Ngrok tunnel ${domain} is healthy again.`);
        }
        failures = 0;
        attempts = 0;
        localUnhealthy = false;
        continue;
      }
      if (signal.aborted) {
        return;
      }
      if (!(await probeAsync(`http://127.0.0.1:${port}`, check))) {
        if (!localUnhealthy && !signal.aborted) {
          logger.warn(`Local service on port ${port} is unhealthy; waiting for it to recover.`);
        }
        localUnhealthy = true;
        failures = 0;
        continue;
      }
      localUnhealthy = false;
      if (currentListener) {
        failures++;
        if (failures < FAILURE_THRESHOLD) {
          continue;
        }
        logger.warn(`Ngrok tunnel ${domain} failed ${failures} health probes; reopening it.`);
        await closeAsync(currentListener, signal);
        currentListener = undefined;
      }
      if (signal.aborted) {
        return;
      }
      attempts++;
      try {
        const reopened = await openAsync({ forceNewSession: true });
        if (reopened.url() !== url) {
          await closeAsync(reopened, signal);
          throw new SystemError(
            `Reopened ngrok tunnel for ${domain} returned a different public URL.`
          );
        }
        currentListener = reopened;
        failures = 0;
      } catch (err) {
        if (!signal.aborted && (attempts === 1 || attempts % 5 === 0)) {
          logger.warn(
            { err, attempt: attempts },
            `Could not reopen ngrok tunnel ${domain}; will retry.`
          );
        }
      }
    }
  }

  const supervision = healthCheck
    ? superviseAsync(healthCheck).catch(err => {
        if (!signal.aborted) {
          logger.warn({ err }, `Ngrok tunnel supervision stopped for ${domain}.`);
        }
      })
    : Promise.resolve();
  let stopTask: Promise<void> | undefined;
  return {
    url,
    subdomainId,
    stopAsync: () =>
      (stopTask ??= (async () => {
        controller.abort();
        await withDeviceRunSessionTimeoutAsync(
          { name: `Ngrok tunnel ${domain} stop`, timeoutMs: STOP_TIMEOUT_MS },
          async stopSignal => {
            await supervision;
            if (currentListener) {
              retiredListeners.add(currentListener);
              currentListener = undefined;
            }
            await Promise.all([pendingOpen?.catch(() => {}), retireListenersAsync(stopSignal)]);
            await retireListenersAsync(stopSignal);
          }
        );
        releaseTarget();
      })()),
  };
}

function isRetryableNgrokError(err: unknown): boolean {
  const code = getNgrokErrorCode(err);
  return code !== null && RETRYABLE_NGROK_ERROR_CODES.has(code);
}

/**
 * The ngrok error code of a failed open. @ngrok/ngrok sets `errorCode` from the message. When it is
 * missing, the code is read from the message here.
 */
function getNgrokErrorCode(err: unknown): string | null {
  if (!(err instanceof Error)) {
    return null;
  }
  const { errorCode } = err as { errorCode?: unknown };
  if (typeof errorCode === 'string') {
    return errorCode;
  }
  return /\berror_code: (ERR_NGROK_\d+)\b/.exec(err.message)?.[1] ?? null;
}

function waitAsync(ms: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) {
    return Promise.resolve(false);
  }
  return new Promise(resolve => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve(true);
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
