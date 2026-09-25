import { type bunyan } from '@expo/logger';
import fetch from 'node-fetch';
import { mkdtemp, open } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { Sentry } from '../../sentry';
import { SERVE_SIM_STATE_DIR, readServeSimServersAsync } from './serveSimMetricsRecorder';

// Require user-app scope acknowledgement; replay cursors avoid duplicate records
// on reconnect. Older servers that ignore the filter are not safe to collect from.
const MAX_BYTES_PER_DEVICE = 20 * 1024 * 1024;
const MAX_DURATION_MS = 30 * 60 * 1000;
const MAX_LINE_LENGTH = 1024 * 1024;
const MAX_CONSECUTIVE_FAILURES = 10;

type CollectedLog = { udid: string; filePath: string };
type Session = {
  controller: AbortController;
  timer: NodeJS.Timeout;
  polling: Promise<void>;
  streams: Map<string, Promise<void>>;
  files: Map<string, CollectedLog>;
  finishing?: Promise<CollectedLog[]>;
};
let activeSession: Session | undefined;

export namespace ServeSimLogsRecorder {
  export async function startAsync({
    logger,
    stateDir = SERVE_SIM_STATE_DIR,
    pollIntervalMs = 2_000,
    maxBytes = MAX_BYTES_PER_DEVICE,
    maxDurationMs = MAX_DURATION_MS,
  }: {
    logger: bunyan;
    stateDir?: string;
    pollIntervalMs?: number;
    maxBytes?: number;
    maxDurationMs?: number;
  }): Promise<void> {
    if (activeSession) {
      return;
    }
    const controller = new AbortController();
    const session: Session = {
      controller,
      timer: setTimeout(() => controller.abort(), maxDurationMs),
      polling: Promise.resolve(),
      streams: new Map(),
      files: new Map(),
    };
    session.timer.unref();
    activeSession = session;
    // Reserve the session before asynchronous setup so concurrent starts are harmless.
    session.polling = (async () => {
      const outputDirectory = await mkdtemp(path.join(os.tmpdir(), 'serve-sim-logs-'));
      const failures = new Map<string, number>();
      const bytes = new Map<string, number>();
      const capped = new Set<string>();
      const cursors = new Map<string, { identity: string; sequence?: number }>();
      while (!controller.signal.aborted) {
        const servers = await readServeSimServersAsync(stateDir);
        const present = new Set(servers.map(server => server.udid));
        for (const udid of failures.keys()) {
          if (!present.has(udid)) {
            failures.delete(udid);
            cursors.delete(udid);
          }
        }
        for (const server of servers) {
          if (controller.signal.aborted) {
            break;
          }
          if (session.streams.has(server.udid) || capped.has(server.udid)) {
            continue;
          }
          const filePath = path.join(outputDirectory, `${encodeURIComponent(server.udid)}.ndjson`);
          const identity = JSON.stringify([server.url, server.token]);
          let cursor = cursors.get(server.udid);
          if (cursor?.identity !== identity) {
            cursor = { identity };
            cursors.set(server.udid, cursor);
            failures.delete(server.udid);
          }
          if ((failures.get(server.udid) ?? 0) >= MAX_CONSECUTIVE_FAILURES) {
            continue;
          }
          failures.set(server.udid, (failures.get(server.udid) ?? 0) + 1);
          const done = streamServeSimLogsToFileAsync({
            serveSimUrl: server.url,
            serveSimToken: server.token,
            serveSimDevice: server.udid,
            since: cursor?.sequence,
            filePath,
            signal: controller.signal,
            logger,
            maxBytes: maxBytes - (bytes.get(server.udid) ?? 0),
          })
            .then(result => {
              bytes.set(server.udid, (bytes.get(server.udid) ?? 0) + result.bytesWritten);
              if (result.lastSequence !== undefined && cursors.get(server.udid) === cursor) {
                cursors.set(server.udid, { identity, sequence: result.lastSequence });
              }
              if (result.receivedData) {
                session.files.set(server.udid, { udid: server.udid, filePath });
                failures.set(server.udid, 0);
                if (result.lastSequence === undefined) {
                  capped.add(server.udid);
                  if (!controller.signal.aborted && !result.limitReached) {
                    logger.warn(
                      `Simulator log stream for ${server.udid} ended without a replay cursor; retaining collected logs without reconnecting.`
                    );
                  }
                }
              }
              if (result.limitReached) {
                capped.add(server.udid);
                logger.warn(`serve-sim simulator logs reached the size limit for ${server.udid}.`);
              }
            })
            .finally(() => session.streams.delete(server.udid));
          session.streams.set(server.udid, done);
        }
        await delay(pollIntervalMs, undefined, { signal: controller.signal }).catch(() => {});
      }
    })().catch(err => {
      logger.warn({ err }, 'Could not collect serve-sim simulator logs.');
      controller.abort();
    });
    logger.info('Started collecting user-app logs (up to 20 MiB per device and 30 minutes).');
  }

  export async function finishAsync({ logger }: { logger: bunyan }): Promise<CollectedLog[]> {
    const session = activeSession;
    if (!session || session.finishing) {
      // Only the first finalizer receives files, preventing duplicate uploads.
      await session?.finishing;
      return [];
    }
    session.finishing = (async () => {
      clearTimeout(session.timer);
      session.controller.abort();
      await session.polling;
      await Promise.all(session.streams.values());
      logger.info('Finished collecting serve-sim simulator logs.');
      return [...session.files.values()];
    })();
    try {
      return await session.finishing;
    } finally {
      activeSession = undefined;
    }
  }
}

export async function streamServeSimLogsToFileAsync({
  serveSimUrl,
  serveSimToken,
  serveSimDevice,
  since,
  filePath,
  signal,
  logger,
  maxBytes = MAX_BYTES_PER_DEVICE,
}: {
  serveSimUrl: string;
  serveSimToken?: string;
  serveSimDevice?: string;
  since?: number;
  filePath: string;
  signal: AbortSignal;
  logger: bunyan;
  maxBytes?: number;
}): Promise<{
  receivedData: boolean;
  limitReached: boolean;
  bytesWritten: number;
  lastSequence?: number;
}> {
  let bytesWritten = 0;
  let limitReached = maxBytes <= 0;
  let lastSequence = since;
  let file: Awaited<ReturnType<typeof open>> | undefined;
  let body: NodeJS.ReadableStream | undefined;
  const closeBody = (): void => {
    (body as import('node:stream').Readable | undefined)?.destroy?.();
  };
  try {
    if (signal.aborted || limitReached) {
      return { receivedData: false, limitReached, bytesWritten };
    }
    const url = new URL('/logs', serveSimUrl);
    url.searchParams.set('envelope', 'true');
    url.searchParams.set('scope', 'user-apps');
    if (since !== undefined) {
      url.searchParams.set('since', String(since));
    }
    if (serveSimDevice) {
      url.searchParams.set('device', serveSimDevice);
    }
    const response = await fetch(url.toString(), {
      signal,
      ...(serveSimToken ? { headers: { Authorization: `Bearer ${serveSimToken}` } } : {}),
    });
    body = response.body;
    signal.addEventListener('abort', closeBody, { once: true });
    if (signal.aborted) {
      closeBody();
      return { receivedData: false, limitReached, bytesWritten };
    }
    if (!response.ok || !response.body) {
      logger.warn(`serve-sim /logs responded ${response.status}; simulator logs will be retried.`);
      return { receivedData: false, limitReached, bytesWritten };
    }
    // Older servers ignore unknown query parameters and would return system logs.
    if (response.headers.get('x-serve-sim-log-scope') !== 'user-apps') {
      logger.warn(
        'serve-sim did not confirm user-app log filtering. Skipping this stream; use a serve-sim version that supports /logs?scope=user-apps.'
      );
      return { receivedData: false, limitReached, bytesWritten };
    }
    file = await open(filePath, 'a');
    const decoder = new TextDecoder();
    let buffer = '';
    let droppingLine = false;
    stream: for await (const chunk of response.body) {
      buffer +=
        typeof chunk === 'string' ? chunk : decoder.decode(chunk as Buffer, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);
        const skip = droppingLine || line.length > MAX_LINE_LENGTH;
        droppingLine = false;
        if (skip || !line.startsWith('data:')) {
          continue;
        }
        let payload = line.slice(5).trim();
        let sequence: number | undefined;
        try {
          const parsed: unknown = JSON.parse(payload);
          if (
            parsed &&
            typeof parsed === 'object' &&
            'seq' in parsed &&
            'raw' in parsed &&
            typeof parsed.seq === 'number' &&
            Number.isSafeInteger(parsed.seq) &&
            parsed.seq >= 0 &&
            typeof parsed.raw === 'string'
          ) {
            sequence = parsed.seq;
            if (lastSequence !== undefined && sequence <= lastSequence) {
              continue;
            }
            // Keep the downloaded artifact homogeneous across old and new servers.
            payload = JSON.stringify(JSON.parse(parsed.raw));
          }
        } catch {
          continue;
        }
        const record = payload + '\n';
        const size = Buffer.byteLength(record);
        if (bytesWritten + size > maxBytes) {
          limitReached = true;
          break stream;
        }
        // Await writes to bound buffering, including during teardown; close waits for these writes.
        await file.writeFile(record);
        bytesWritten += size;
        if (sequence !== undefined) {
          lastSequence = sequence;
        }
        if (bytesWritten >= maxBytes) {
          limitReached = true;
          break stream;
        }
      }
      if (buffer.length > MAX_LINE_LENGTH) {
        buffer = '';
        droppingLine = true;
      }
    }
  } catch (err) {
    if (!signal.aborted) {
      logger.warn(
        { err },
        'serve-sim simulator log stream ended; collected logs will be retained.'
      );
    }
  } finally {
    signal.removeEventListener('abort', closeBody);
    closeBody();
    await file?.close().catch(err => {
      logger.warn({ err }, 'Could not close the simulator log file.');
    });
  }
  return {
    receivedData: bytesWritten > 0,
    limitReached,
    bytesWritten,
    ...(lastSequence !== undefined ? { lastSequence } : {}),
  };
}
