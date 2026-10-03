import { SystemError } from '@expo/eas-build-job';
import { type bunyan } from '@expo/logger';
import * as ngrok from '@ngrok/ngrok';
import { randomBytes } from 'node:crypto';
import { clearTimeout, setTimeout } from 'node:timers';

import { turtleFetch } from '../../utils/turtleFetch';
import { withDeviceRunSessionTimeoutAsync } from './deviceRunSessionTimeout';

const PROBE_INTERVAL_MS = 15_000;
const FAILURE_THRESHOLD = 3;
const STOP_TIMEOUT_MS = 4_000;

export type NgrokTunnelHandle = {
  url: string;
  subdomainId: string;
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
}: {
  port: number;
  subdomainPrefix: string;
  subdomainId?: string;
  baseDomain: string;
  authtoken: string;
  rewriteHostHeader?: boolean;
  healthCheck?: { path: string; statuses?: number[] };
  logger: bunyan;
}): Promise<NgrokTunnelHandle> {
  const domain = `${subdomainPrefix}-${subdomainId}.${baseDomain}`;
  const controller = new AbortController();
  const { signal } = controller;
  const config: ngrok.Config = {
    addr: port,
    authtoken,
    domain,
    ...(rewriteHostHeader ? { request_header_add: [`Host:localhost:${port}`] } : {}),
  };

  const retiredListeners = new Set<ngrok.Listener>();
  const closingListeners = new Map<ngrok.Listener, Promise<void>>();

  async function closeAsync(
    listener: ngrok.Listener,
    closeSignal: AbortSignal | undefined,
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
      if (logFailure && !closeSignal?.aborted) {
        logger.warn({ err }, `Could not stop ngrok tunnel ${domain}.`);
      }
    }
  }

  async function retireListenersAsync(retirementSignal: AbortSignal): Promise<void> {
    while (retiredListeners.size > 0) {
      retirementSignal.throwIfAborted();
      await Promise.all(
        [...retiredListeners].map(retired => closeAsync(retired, retirementSignal, false))
      );
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
        retireListenersAsync
      );
    } catch {}
  }

  let openingInProgress = false;
  async function openAsync(forceNewSession = false): Promise<ngrok.Listener> {
    if (openingInProgress) {
      throw new SystemError(`A previous ngrok tunnel open for ${domain} is still pending.`);
    }
    let acquired: ngrok.Listener | undefined;
    let retirement: Promise<void> | undefined;
    const retireAcquired = () => {
      if (acquired) {
        retirement ??= retireLateListenerAsync(acquired);
      }
    };
    try {
      return await withDeviceRunSessionTimeoutAsync(
        { name: 'Ngrok tunnel open', timeoutMs: 15_000, signal },
        async openSignal => {
          openSignal.throwIfAborted();
          const opening = ngrok
            .forward({
              ...config,
              ...(forceNewSession ? { force_new_session: true } : {}),
            })
            .finally(() => {
              openingInProgress = false;
            });
          openingInProgress = true;
          void opening
            .then(listener => {
              acquired = listener;
              if (openSignal.aborted) {
                retireAcquired();
              }
            })
            .catch(() => {});
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

  logger.info(`Starting ngrok tunnel ${domain} -> http://localhost:${port}.`);
  let listener: ngrok.Listener | undefined = await openAsync();
  const publicUrl = listener.url();
  if (!publicUrl) {
    await closeAsync(listener, signal);
    throw new SystemError(`ngrok tunnel for ${domain} did not return a public URL.`);
  }

  const url = publicUrl;

  async function probeAsync(baseUrl: string): Promise<boolean> {
    if (!healthCheck) {
      return true;
    }
    const { path, statuses = [200] } = healthCheck;
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

  async function superviseAsync(): Promise<void> {
    let failures = 0;
    let attempts = 0;
    let localUnhealthy = false;
    while (
      await waitAsync(
        listener || localUnhealthy
          ? PROBE_INTERVAL_MS
          : Math.min(1_000 * 2 ** Math.min(attempts, 5), 30_000),
        signal
      )
    ) {
      await Promise.all([...retiredListeners].map(retired => closeAsync(retired, signal)));
      if (signal.aborted) {
        return;
      }
      if (listener && (await probeAsync(url))) {
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
      if (!(await probeAsync(`http://127.0.0.1:${port}`))) {
        if (!localUnhealthy && !signal.aborted) {
          logger.warn(
            `Local service on port ${port} is unhealthy; keeping ngrok tunnel ${domain}.`
          );
        }
        localUnhealthy = true;
        failures = 0;
        continue;
      }
      localUnhealthy = false;
      if (listener) {
        failures++;
        if (failures < FAILURE_THRESHOLD) {
          continue;
        }
        logger.warn(`Ngrok tunnel ${domain} failed ${failures} health probes; reopening it.`);
        await closeAsync(listener, signal);
        listener = undefined;
      }
      if (signal.aborted) {
        return;
      }
      attempts++;
      try {
        const reopened = await openAsync(/* forceNewSession */ true);
        if (reopened.url() !== url) {
          await closeAsync(reopened, signal);
          throw new SystemError(
            `Reopened ngrok tunnel for ${domain} returned a different public URL.`
          );
        }
        listener = reopened;
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
    ? superviseAsync().catch(err => {
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
        try {
          await withDeviceRunSessionTimeoutAsync(
            { name: 'Ngrok tunnel stop', timeoutMs: STOP_TIMEOUT_MS },
            async stopSignal => {
              await supervision;
              if (listener) {
                retiredListeners.add(listener);
                listener = undefined;
              }
              await retireListenersAsync(stopSignal);
            }
          );
        } catch (err) {
          logger.warn({ err }, `Could not stop ngrok tunnel ${domain}.`);
          throw err;
        }
      })()),
  };
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
