import { type bunyan } from '@expo/logger';
import fetch from 'node-fetch';
import { type WriteStream, createWriteStream } from 'node:fs';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { Sentry } from '../../sentry';

const POLL_INTERVAL_MS = 2_000;
// Consecutive failed connects per device; reset once a stream yields a sample.
const MAX_CONSECUTIVE_STREAM_FAILURES_PER_DEVICE = 10;
const END_STREAM_TIMEOUT_MS = 2_000;
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
  meta: Map<string, Record<string, unknown>>;
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
      meta: new Map(),
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
  }): Promise<{ udid: string; filePath: string; meta: Record<string, unknown> | undefined }[]> {
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
    return [...session.files.entries()].map(([udid, filePath]) => ({
      udid,
      filePath,
      meta: session.meta.get(udid),
    }));
  }
}

async function pollServeSimMetricsAsync(session: ServeSimMetricsSession): Promise<void> {
  const { abortController, logger } = session;
  while (!abortController.signal.aborted) {
    const servers = await readServeSimServersAsync(session.stateDir);
    // Forget the failure count for a device that has left the registry, so a
    // serve-sim that restarts for the same udid is retried (mirrors the recordings poller).
    const present = new Set(servers.map(server => server.udid));
    for (const udid of session.attempts.keys()) {
      if (!present.has(udid)) {
        session.attempts.delete(udid);
      }
    }
    for (const server of servers) {
      if (session.activeStreams.has(server.udid)) {
        continue;
      }
      const failures = session.attempts.get(server.udid) ?? 0;
      if (failures >= MAX_CONSECUTIVE_STREAM_FAILURES_PER_DEVICE) {
        continue;
      }
      session.attempts.set(server.udid, failures + 1);

      let filePath = session.files.get(server.udid);
      if (!filePath) {
        filePath = path.join(session.outputDirectory, `${server.udid}.ndjson`);
        session.files.set(server.udid, filePath);
      }

      const streamAbortController = new AbortController();
      const streamSignal = AbortSignal.any([abortController.signal, streamAbortController.signal]);
      logger.info(`Collecting serve-sim metrics for ${server.udid}.`);
      const donePromise = streamServeSimMetricsToFileAsync({
        serveSimUrl: server.url,
        filePath,
        signal: streamSignal,
        logger,
      })
        .then(({ receivedData, meta }) => {
          if (receivedData) {
            session.attempts.set(server.udid, 0);
          }
          if (meta) {
            session.meta.set(server.udid, meta);
          }
        })
        .finally(() => {
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
}): Promise<{ receivedData: boolean; meta: Record<string, unknown> | undefined }> {
  const file = createWriteStream(filePath, { flags: 'a' });
  file.on('error', err => {
    logger.warn({ err }, `serve-sim metrics file write failed for ${filePath}.`);
  });
  let receivedData = false;
  let meta: Record<string, unknown> | undefined;
  try {
    const response = await fetch(new URL('/metrics', serveSimUrl).toString(), { signal });
    if (!response.ok || !response.body) {
      logger.warn(`serve-sim /metrics responded ${response.status} for ${serveSimUrl}.`);
      return { receivedData, meta };
    }
    // One decoder so a multi-byte character split across chunks isn't corrupted.
    const decoder = new TextDecoder();
    let buffer = '';
    let event = 'message';
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk as Buffer, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (line === '') {
          event = 'message';
        } else if (line.startsWith('event:')) {
          event = line.slice('event:'.length).trim();
        } else if (line.startsWith('data:')) {
          const payload = line.slice('data:'.length).trim();
          if (payload && event === 'meta') {
            // Keep the meta out of the NDJSON (so it stays homogeneous and reconnects
            // don't re-append it) but hold onto it for the artifact metadata.
            try {
              meta = JSON.parse(payload) as Record<string, unknown>;
            } catch {
              // ignore a malformed meta frame
            }
          } else if (payload) {
            file.write(payload + '\n');
            receivedData = true;
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
    await endWriteStreamAsync(file);
  }
  return { receivedData, meta };
}

// An errored write stream may never fire `end`'s callback, so also settle on
// close/error and a timeout to avoid hanging teardown.
async function endWriteStreamAsync(file: WriteStream): Promise<void> {
  await new Promise<void>(resolve => {
    let settled = false;
    const done = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, END_STREAM_TIMEOUT_MS);
    timer.unref();
    file.once('close', done);
    file.once('error', done);
    file.end(done);
  });
}
