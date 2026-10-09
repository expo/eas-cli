import { type bunyan } from '@expo/logger';
import fetch from 'node-fetch';
import { mkdtemp, open } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';

import { SERVE_SIM_STATE_DIR, readServeSimServersAsync } from './serveSimMetricsRecorder';

const MAX_BYTES_PER_DEVICE = 20 * 1024 * 1024;
const MAX_OCCURRENCES_PER_DEVICE = 1_000;
const MAX_CONSECUTIVE_FAILURES = 10;
const MAX_FRAME_LENGTH = 1024 * 1024;

const SummarySchema = z.object({
  id: z.string(),
  occurrenceTimes: z.array(z.object({ key: z.number().int().nonnegative() })),
});
const FrameSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('meta'), meta: z.object({ statusError: z.string().nullable() }) }),
  z.object({ type: z.literal('list'), crashes: z.array(SummarySchema) }),
  z.object({ type: z.enum(['crash', 'recurred']), record: SummarySchema }),
]);
const DetailSchema = z.object({
  record: z.object({ id: z.string() }).passthrough(),
  occurrence: z.object({ key: z.number().int().nonnegative() }).passthrough(),
  report: z.string().nullable(),
  reportError: z.string().nullable(),
});

type CollectedCrashes = { udid: string; filePath: string };
type FinishedCrashes = { outputDirectory: string | null; crashes: CollectedCrashes[] };
type Device = {
  identity: string;
  seen: Set<string>;
  bytesWritten: number;
  limitReached: boolean;
  failures: number;
};
type Session = {
  outputDirectory: string;
  controller: AbortController;
  timer: NodeJS.Timeout;
  polling: Promise<void>;
  streams: Map<string, Promise<void>>;
  files: Map<string, CollectedCrashes>;
  stopping?: Promise<void>;
  finishing?: Promise<FinishedCrashes>;
};
let activeSession: Session | undefined;

export namespace ServeSimCrashesRecorder {
  export async function startAsync({
    logger,
    stateDir = SERVE_SIM_STATE_DIR,
    pollIntervalMs = 2_000,
    maxBytes = MAX_BYTES_PER_DEVICE,
    maxDurationMs = 30 * 60 * 1000,
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
    const outputDirectory = await mkdtemp(path.join(os.tmpdir(), 'serve-sim-crashes-'));
    const controller = new AbortController();
    const session: Session = {
      outputDirectory,
      controller,
      timer: setTimeout(() => {
        logger.warn(
          'Simulator crash collection reached its duration limit; collected reports will be retained.'
        );
        controller.abort();
      }, maxDurationMs),
      polling: Promise.resolve(),
      streams: new Map(),
      files: new Map(),
    };
    session.timer.unref();
    activeSession = session;
    session.polling = (async () => {
      const devices = new Map<string, Device>();
      while (!controller.signal.aborted) {
        const servers = await readServeSimServersAsync(stateDir);
        for (const server of servers) {
          if (controller.signal.aborted) {
            break;
          }
          if (session.streams.has(server.udid)) {
            continue;
          }
          const identity = JSON.stringify([server.url, server.token]);
          let device = devices.get(server.udid);
          if (!device) {
            device = {
              identity,
              seen: new Set(),
              bytesWritten: 0,
              limitReached: false,
              failures: 0,
            };
            devices.set(server.udid, device);
          } else if (device.identity !== identity) {
            device.identity = identity;
            device.seen.clear();
            device.failures = 0;
          }
          if (device.limitReached) {
            continue;
          }
          if (device.failures >= MAX_CONSECUTIVE_FAILURES) {
            if (device.failures === MAX_CONSECUTIVE_FAILURES) {
              logger.warn(
                `Stopped retrying simulator crash collection for ${server.udid} after ${MAX_CONSECUTIVE_FAILURES} failed connections; collected reports will be retained.`
              );
              device.failures += 1;
            }
            continue;
          }
          device.failures += 1;
          const filePath = path.join(outputDirectory, `${encodeURIComponent(server.udid)}.ndjson`);
          const done = recordServeSimCrashesAsync({
            server,
            filePath,
            device,
            signal: controller.signal,
            logger,
            maxBytes,
            onRecorded: () => session.files.set(server.udid, { udid: server.udid, filePath }),
          }).finally(() => session.streams.delete(server.udid));
          session.streams.set(server.udid, done);
        }
        await delay(pollIntervalMs, undefined, { signal: controller.signal }).catch(() => {});
      }
    })().catch(() => {
      logger.warn('Could not collect simulator crashes; collected reports will be retained.');
      controller.abort();
    });
    logger.info('Started collecting simulator crashes (up to 20 MiB per device and 30 minutes).');
  }

  export async function stopAsync(): Promise<void> {
    const session = activeSession;
    if (!session) {
      return;
    }
    session.stopping ??= (async () => {
      clearTimeout(session.timer);
      session.controller.abort();
      await session.polling;
      await Promise.all(session.streams.values());
    })();
    await session.stopping;
  }

  export async function finishAsync(): Promise<FinishedCrashes> {
    const session = activeSession;
    if (!session || session.finishing) {
      await session?.finishing;
      return { outputDirectory: null, crashes: [] };
    }
    session.finishing = (async () => {
      await stopAsync();
      return { outputDirectory: session.outputDirectory, crashes: [...session.files.values()] };
    })();
    try {
      return await session.finishing;
    } finally {
      activeSession = undefined;
    }
  }
}

async function recordServeSimCrashesAsync({
  server,
  filePath,
  device,
  signal,
  logger,
  maxBytes,
  onRecorded,
}: {
  server: { udid: string; url: string; token?: string };
  filePath: string;
  device: Device;
  signal: AbortSignal;
  logger: bunyan;
  maxBytes: number;
  onRecorded: () => void;
}): Promise<void> {
  const controller = new AbortController();
  let file: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const url = new URL('/crashes', server.url);
    url.searchParams.set('device', server.udid);
    url.searchParams.set('tail', '1');
    const response = await fetch(url.toString(), {
      redirect: 'error',
      signal: AbortSignal.any([signal, controller.signal]),
      headers: {
        Accept: 'text/event-stream',
        ...(server.token ? { Authorization: `Bearer ${server.token}` } : {}),
      },
    });
    if (
      !response.ok ||
      !response.body ||
      !response.headers.get('content-type')?.includes('text/event-stream')
    ) {
      throw new Error('Crash stream unavailable');
    }
    device.failures = 0;
    const decoder = new TextDecoder();
    let buffer = '';
    stream: for await (const chunk of response.body) {
      buffer += decoder.decode(chunk as Buffer, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);
        if (line.length > MAX_FRAME_LENGTH) {
          throw new Error('Crash frame exceeded limit');
        }
        if (!line.startsWith('data:')) {
          continue;
        }
        const frame = FrameSchema.safeParse(JSON.parse(line.slice(5)));
        if (!frame.success) {
          continue;
        }
        if (frame.data.type === 'meta') {
          if (frame.data.meta.statusError) {
            logger.warn(
              'serve-sim cannot watch crash reports; crash collection will resume when the watcher recovers.'
            );
          }
          continue;
        }
        const summaries = frame.data.type === 'list' ? frame.data.crashes : [frame.data.record];
        for (const summary of summaries) {
          for (const occurrence of summary.occurrenceTimes) {
            if (signal.aborted) {
              break stream;
            }
            const key = JSON.stringify([summary.id, occurrence.key]);
            if (device.seen.has(key)) {
              continue;
            }
            const detailUrl = new URL(`/crashes/${encodeURIComponent(summary.id)}`, server.url);
            detailUrl.searchParams.set('device', server.udid);
            detailUrl.searchParams.set('key', String(occurrence.key));
            const detail = await readCrashDetailAsync(detailUrl, server.token);
            if (!detail) {
              logger.warn(
                `Crash occurrence ${occurrence.key} is no longer available for ${server.udid}; earlier reports will be retained.`
              );
              continue;
            }
            if (detail.record.id !== summary.id || detail.occurrence.key !== occurrence.key) {
              throw new Error('Crash detail does not match the requested occurrence');
            }
            const record = JSON.stringify(detail) + '\n';
            const size = Buffer.byteLength(record);
            if (
              device.bytesWritten + size > maxBytes ||
              device.seen.size >= MAX_OCCURRENCES_PER_DEVICE
            ) {
              device.limitReached = true;
              logger.warn(
                `Simulator crash collection reached its limit for ${server.udid}; collected reports will be retained.`
              );
              break stream;
            }
            file ??= await open(filePath, 'a', 0o600);
            await file.writeFile(record);
            device.bytesWritten += size;
            device.seen.add(key);
            onRecorded();
          }
        }
      }
      if (buffer.length > MAX_FRAME_LENGTH) {
        throw new Error('Crash frame exceeded limit');
      }
    }
  } catch {
    if (!signal.aborted) {
      logger.warn(`Simulator crash stream for ${server.udid} ended; collection will be retried.`);
    }
  } finally {
    controller.abort();
    await file?.close().catch(() => logger.warn('Could not close the simulator crash artifact.'));
  }
}

async function readCrashDetailAsync(
  url: URL,
  token?: string
): Promise<z.infer<typeof DetailSchema> | undefined> {
  const controller = new AbortController();
  try {
    const response = await fetch(url.toString(), {
      redirect: 'error',
      size: 8 * 1024 * 1024,
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5_000)]),
      ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
    });
    if (response.status === 404) {
      return undefined;
    }
    if (!response.ok) {
      throw new Error('Crash detail request failed');
    }
    return DetailSchema.parse(await response.json());
  } finally {
    controller.abort();
  }
}
