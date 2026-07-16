import { type bunyan } from '@expo/logger';
import fetch from 'node-fetch';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { Sentry } from '../../sentry';

const POLL_INTERVAL_MS = 2_000;
const MAX_STREAM_ATTEMPTS_PER_DEVICE = 10;
// serve-sim's own per-device registry while serving: `${tmpdir}/serve-sim/server-<udid>.json`.
const SERVE_SIM_STATE_DIR = path.join(os.tmpdir(), 'serve-sim');

type ServeSimServer = { udid: string; url: string };

type ServeSimMetricsSession = {
  logger: bunyan;
  stateDir: string;
  pollIntervalMs: number;
  outputDirectory: string;
  files: Map<string, string>;
  attempts: Map<string, number>;
  activeStreams: Map<string, { abortController: AbortController; donePromise: Promise<void> }>;
  pollingPromise: Promise<void>;
  abortController: AbortController;
};

let activeSession: ServeSimMetricsSession | null = null;

export namespace ServeSimMetricsRecorder {
  export async function startAsync({
    logger,
    stateDir = SERVE_SIM_STATE_DIR,
    pollIntervalMs = POLL_INTERVAL_MS,
  }: {
    logger: bunyan;
    stateDir?: string;
    pollIntervalMs?: number;
  }): Promise<void> {
    if (activeSession) {
      logger.info('serve-sim metrics polling is already running.');
      return;
    }
    const outputDirectory = await mkdtemp(path.join(os.tmpdir(), 'serve-sim-metrics-'));
    const session: ServeSimMetricsSession = {
      logger,
      stateDir,
      pollIntervalMs,
      outputDirectory,
      files: new Map(),
      attempts: new Map(),
      activeStreams: new Map(),
      pollingPromise: Promise.resolve(),
      abortController: new AbortController(),
    };
    activeSession = session;

    logger.info('Started polling serve-sim for cpu/mem metrics.');
    session.pollingPromise = pollServeSimMetricsAsync(session).catch(err => {
      const error = err instanceof Error ? err : new Error(String(err));
      Sentry.capture('serve-sim metrics poller failed', error);
      logger.warn({ err: error }, 'serve-sim metrics poller failed.');
    });
  }

  export async function finishAsync({
    logger,
  }: {
    logger: bunyan;
  }): Promise<{ udid: string; filePath: string }[]> {
    const session = activeSession;
    if (!session) {
      logger.info('No serve-sim metrics polling is running.');
      return [];
    }
    activeSession = null;

    session.abortController.abort();
    await session.pollingPromise;
    await Promise.all(
      [...session.activeStreams.values()].map(async stream => {
        stream.abortController.abort();
        await stream.donePromise;
      })
    );
    return [...session.files.entries()].map(([udid, filePath]) => ({ udid, filePath }));
  }
}

async function pollServeSimMetricsAsync(session: ServeSimMetricsSession): Promise<void> {
  const { abortController, logger } = session;
  while (!abortController.signal.aborted) {
    for (const server of await readServeSimServersAsync(session.stateDir)) {
      if (session.activeStreams.has(server.udid)) {
        continue;
      }
      const attempts = session.attempts.get(server.udid) ?? 0;
      if (attempts >= MAX_STREAM_ATTEMPTS_PER_DEVICE) {
        continue;
      }
      session.attempts.set(server.udid, attempts + 1);

      let filePath = session.files.get(server.udid);
      if (!filePath) {
        filePath = path.join(session.outputDirectory, `${server.udid}.ndjson`);
        session.files.set(server.udid, filePath);
      }

      const streamAbortController = new AbortController();
      const streamSignal = AbortSignal.any([abortController.signal, streamAbortController.signal]);
      logger.info(`Collecting serve-sim metrics for ${server.udid}.`);
      // Free the slot when the stream ends so the poller reconnects if the server is still up (an
      // early race or a mid-session drop), up to the per-device attempt cap.
      const donePromise = streamServeSimMetricsToFileAsync({
        serveSimUrl: server.url,
        filePath,
        signal: streamSignal,
        logger,
      }).finally(() => {
        session.activeStreams.delete(server.udid);
      });
      session.activeStreams.set(server.udid, {
        abortController: streamAbortController,
        donePromise,
      });
    }
    await delay(session.pollIntervalMs, undefined, { signal: abortController.signal }).catch(
      () => {}
    );
  }
}

export async function readServeSimServersAsync(stateDir: string): Promise<ServeSimServer[]> {
  let entries: string[];
  try {
    entries = await readdir(stateDir);
  } catch {
    return [];
  }
  const servers: ServeSimServer[] = [];
  for (const entry of entries) {
    if (!/^server-.+\.json$/.test(entry)) {
      continue;
    }
    try {
      const state = JSON.parse(await readFile(path.join(stateDir, entry), 'utf-8')) as {
        device?: unknown;
        url?: unknown;
      };
      if (typeof state.device === 'string' && typeof state.url === 'string') {
        servers.push({ udid: state.device, url: state.url });
      }
    } catch {
      continue;
    }
  }
  return servers;
}

export async function streamServeSimMetricsToFileAsync({
  serveSimUrl,
  filePath,
  signal,
  logger,
}: {
  serveSimUrl: string;
  filePath: string;
  signal: AbortSignal;
  logger: bunyan;
}): Promise<void> {
  const file = createWriteStream(filePath, { flags: 'a' });
  file.on('error', err => {
    logger.warn({ err }, `serve-sim metrics file write failed for ${filePath}.`);
  });
  try {
    const response = await fetch(new URL('/metrics', serveSimUrl).toString(), { signal });
    if (!response.ok || !response.body) {
      logger.warn(`serve-sim /metrics responded ${response.status} for ${serveSimUrl}.`);
      return;
    }
    let buffer = '';
    for await (const chunk of response.body) {
      buffer += chunk.toString();
      let newline: number;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (line.startsWith('data:')) {
          const payload = line.slice('data:'.length).trim();
          if (payload) {
            file.write(payload + '\n');
          }
        }
      }
    }
  } catch (err) {
    // Stream ends (teardown abort, serve-sim exit/restart) are expected and reconnected by the
    // poller, so log rather than report — best-effort telemetry shouldn't page.
    if (!signal.aborted) {
      logger.warn({ err }, `serve-sim /metrics stream ended for ${serveSimUrl}.`);
    }
  } finally {
    await new Promise<void>(resolve => file.end(() => resolve()));
  }
}
