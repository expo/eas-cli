import { type bunyan } from '@expo/logger';
import fetch from 'node-fetch';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';

import { SERVE_SIM_STATE_DIR, readServeSimServersAsync } from './serveSimMetricsRecorder';

const MAX_BYTES_PER_DEVICE = 20 * 1024 * 1024;
const MAX_REPORTS_PER_DEVICE = 1_000;
const MAX_CONSECUTIVE_FAILURES = 10;
const MAX_FRAME_LENGTH = 1024 * 1024;
const MAX_DETAIL_BYTES = 8 * 1024 * 1024;
// A 5xx, timeout, or dropped connection is retried; a missing or unusable detail is not.
const MAX_DETAIL_ATTEMPTS = 3;
const DETAIL_RETRY_DELAY_MS = 500;
// serve-sim lists a crash about 5 s after it happens, once ReportCrash has written the report,
// so stopping checks each device once more for occurrences the stream had not delivered yet.
const FINAL_PASS_TIMEOUT_MS = 10_000;

const SummarySchema = z.object({
  id: z.string(),
  appName: z.string().nullable().optional(),
  procName: z.string().nullable().optional(),
  occurrenceTimes: z.array(
    z.object({
      key: z.number().int().nonnegative(),
      capturedAtMs: z.number().nullable().optional(),
      rawPath: z.string().optional(),
    })
  ),
});
const FrameSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('meta'), meta: z.object({ statusError: z.string().nullable() }) }),
  z.object({ type: z.literal('list'), crashes: z.array(SummarySchema) }),
  z.object({ type: z.enum(['crash', 'recurred']), record: SummarySchema }),
]);
const ListSchema = z.object({ crashes: z.array(SummarySchema) });
const DetailSchema = z.object({
  record: z.object({ id: z.string() }),
  occurrence: z.object({
    key: z.number().int().nonnegative(),
    incidentId: z.string().nullable().optional(),
  }),
  report: z.string().nullable(),
});

/** A detail that will not change on retry: mismatched, malformed, or over 8 MiB. */
class UnusableDetailError extends Error {}

type ServeSimServer = { udid: string; url: string; token?: string };
export type CollectedCrash = {
  udid: string;
  filePath: string;
  size: number;
  number: number;
  processName?: string;
};
type FinishedCrashes = { outputDirectory: string | null; crashes: CollectedCrash[] };
type Device = {
  // The latest registry entry; unset while the server is absent, so its return counts as new.
  server?: ServeSimServer;
  identity?: string;
  // Occurrences saved or skipped; reconnects replay the retained list and must not retry them.
  handled: Set<string>;
  incidents: Set<string>;
  bytesWritten: number;
  reportsWritten: number;
  limitReached: boolean;
  failures: number;
  stoppedRetrying: boolean;
  warnedStatusError: boolean;
};
type Session = {
  outputDirectory: string;
  logger: bunyan;
  maxBytes: number;
  controller: AbortController;
  timer: NodeJS.Timeout;
  polling: Promise<void>;
  streams: Map<string, Promise<void>>;
  devices: Map<string, Device>;
  files: CollectedCrash[];
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
    const controller = new AbortController();
    const session: Session = {
      outputDirectory: await mkdtemp(path.join(os.tmpdir(), 'serve-sim-crashes-')),
      logger,
      maxBytes,
      controller,
      timer: setTimeout(() => {
        logger.warn(
          'Simulator crash collection reached its duration limit; collected reports will be retained.'
        );
        controller.abort();
      }, maxDurationMs),
      polling: Promise.resolve(),
      streams: new Map(),
      devices: new Map(),
      files: [],
    };
    session.timer.unref();
    activeSession = session;
    session.polling = (async () => {
      while (!controller.signal.aborted) {
        const servers = await readServeSimServersAsync(stateDir);
        const present = new Set(servers.map(server => server.udid));
        for (const [udid, device] of session.devices) {
          if (!present.has(udid)) {
            device.server = undefined;
            device.identity = undefined;
          }
        }
        for (const server of servers) {
          if (controller.signal.aborted) {
            break;
          }
          if (session.streams.has(server.udid)) {
            continue;
          }
          const device = getDevice(session, server.udid);
          const identity = JSON.stringify([server.url, server.token]);
          device.server = server;
          if (device.identity !== identity) {
            device.identity = identity;
            device.failures = 0;
            device.stoppedRetrying = false;
          }
          if (device.limitReached || device.stoppedRetrying) {
            continue;
          }
          if (device.failures >= MAX_CONSECUTIVE_FAILURES) {
            device.stoppedRetrying = true;
            logger.warn(
              `Stopped retrying simulator crash collection for ${server.udid} after ${MAX_CONSECUTIVE_FAILURES} failed connections; collected reports will be retained.`
            );
            continue;
          }
          device.failures += 1;
          const done = streamServeSimCrashesAsync(session, server, device).finally(() =>
            session.streams.delete(server.udid)
          );
          session.streams.set(server.udid, done);
        }
        await delay(pollIntervalMs, undefined, { signal: controller.signal }).catch(() => {});
      }
    })().catch(err => {
      logger.warn(
        { err },
        'Could not collect simulator crashes; collected reports will be retained.'
      );
      controller.abort();
    });
    logger.info('Started collecting simulator crashes (up to 20 MiB per device and 30 minutes).');
  }

  /** Never rejects. */
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
      await collectRemainingCrashesAsync(session);
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
      return { outputDirectory: session.outputDirectory, crashes: session.files };
    })();
    try {
      return await session.finishing;
    } finally {
      if (activeSession === session) {
        activeSession = undefined;
      }
    }
  }
}

function getDevice(session: Session, udid: string): Device {
  let device = session.devices.get(udid);
  if (!device) {
    device = {
      handled: new Set(),
      incidents: new Set(),
      bytesWritten: 0,
      reportsWritten: 0,
      limitReached: false,
      failures: 0,
      stoppedRetrying: false,
      warnedStatusError: false,
    };
    session.devices.set(udid, device);
  }
  return device;
}

async function streamServeSimCrashesAsync(
  session: Session,
  server: ServeSimServer,
  device: Device
): Promise<void> {
  const { logger } = session;
  const signal = session.controller.signal;
  const controller = new AbortController();
  try {
    const url = new URL('/crashes', server.url);
    url.searchParams.set('device', server.udid);
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
      throw new Error(`serve-sim /crashes responded ${response.status}`);
    }
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const chunk of response.body) {
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
          if (frame.data.meta.statusError && !device.warnedStatusError) {
            device.warnedStatusError = true;
            logger.warn(
              'serve-sim cannot watch crash reports; crash collection will resume when the watcher recovers.'
            );
          }
          continue;
        }
        const summaries = frame.data.type === 'list' ? frame.data.crashes : [frame.data.record];
        await saveOccurrencesAsync(session, server, device, summaries, { stop: signal });
        if (signal.aborted || device.limitReached) {
          return;
        }
        device.failures = 0;
      }
      if (buffer.length > MAX_FRAME_LENGTH) {
        throw new Error('Crash frame exceeded limit');
      }
    }
  } catch (err) {
    if (!signal.aborted) {
      logger.warn(
        { err },
        `Simulator crash stream for ${server.udid} ended; collection will be retried.`
      );
    }
  } finally {
    controller.abort();
  }
}

/** One look at each device's crash list, for occurrences the stream had not delivered. */
async function collectRemainingCrashesAsync(session: Session): Promise<void> {
  const signal = AbortSignal.timeout(FINAL_PASS_TIMEOUT_MS);
  await Promise.all(
    [...session.devices.values()].map(async device => {
      const { server } = device;
      if (!server || device.limitReached) {
        return;
      }
      try {
        const url = new URL('/crashes', server.url);
        url.searchParams.set('device', server.udid);
        const response = await fetch(url.toString(), {
          redirect: 'error',
          signal,
          headers: {
            Accept: 'application/json',
            ...(server.token ? { Authorization: `Bearer ${server.token}` } : {}),
          },
        });
        if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
          throw new Error(`serve-sim /crashes responded ${response.status}`);
        }
        const { crashes } = ListSchema.parse(await response.json());
        await saveOccurrencesAsync(session, server, device, crashes, {
          stop: signal,
          deadline: signal,
        });
      } catch (err) {
        session.logger.warn(
          { err },
          `Could not check ${server.udid} for crashes before the session ended; collected reports will be retained.`
        );
      }
    })
  );
}

async function saveOccurrencesAsync(
  session: Session,
  server: ServeSimServer,
  device: Device,
  summaries: z.infer<typeof SummarySchema>[],
  // `stop` ends the loop between occurrences; `deadline` also aborts a download in progress.
  { stop, deadline }: { stop: AbortSignal; deadline?: AbortSignal }
): Promise<void> {
  const { logger } = session;
  for (const summary of summaries) {
    for (const occurrence of summary.occurrenceTimes) {
      if (stop.aborted || device.limitReached) {
        return;
      }
      // Keys restart when serve-sim does; the capture time and report path tell such occurrences apart.
      const key = JSON.stringify([
        summary.id,
        occurrence.key,
        occurrence.capturedAtMs ?? null,
        occurrence.rawPath ?? null,
      ]);
      if (device.handled.has(key)) {
        continue;
      }
      let detail: z.infer<typeof DetailSchema> | undefined;
      try {
        for (let attempt = 1; ; attempt++) {
          try {
            detail = await readCrashDetailAsync(server, summary.id, occurrence.key, deadline);
            break;
          } catch (err) {
            if (err instanceof UnusableDetailError || attempt >= MAX_DETAIL_ATTEMPTS) {
              throw err;
            }
            await delay(DETAIL_RETRY_DELAY_MS, undefined, { signal: stop });
          }
        }
      } catch (err) {
        // Stopping leaves the occurrence unhandled, so the final pass can still save it.
        if (stop.aborted || deadline?.aborted) {
          return;
        }
        device.handled.add(key);
        logger.warn(
          { err },
          `Could not download crash occurrence ${occurrence.key} for ${server.udid}; skipping it.`
        );
        continue;
      }
      device.handled.add(key);
      if (!detail) {
        logger.warn(
          `Crash occurrence ${occurrence.key} is no longer available for ${server.udid}; earlier reports will be retained.`
        );
        continue;
      }
      const { incidentId } = detail.occurrence;
      if (incidentId && device.incidents.has(incidentId)) {
        continue;
      }
      if (!detail.report) {
        logger.warn(
          `Crash occurrence ${occurrence.key} has no native report for ${server.udid}; skipping its artifact.`
        );
        continue;
      }
      const size = Buffer.byteLength(detail.report);
      if (
        device.bytesWritten + size > session.maxBytes ||
        device.reportsWritten >= MAX_REPORTS_PER_DEVICE
      ) {
        device.limitReached = true;
        logger.warn(
          `Simulator crash collection reached its limit for ${server.udid}; collected reports will be retained.`
        );
        return;
      }
      const number = device.reportsWritten + 1;
      const filePath = path.join(session.outputDirectory, `${server.udid}-${number}.ips`);
      try {
        await writeFile(filePath, detail.report, { mode: 0o600, flag: 'wx' });
      } catch (error) {
        device.handled.delete(key);
        await rm(filePath, { force: true }).catch(() => {});
        throw error;
      }
      device.bytesWritten += size;
      device.reportsWritten = number;
      if (incidentId) {
        device.incidents.add(incidentId);
      }
      const processName = summary.appName ?? summary.procName ?? undefined;
      session.files.push({
        udid: server.udid,
        filePath,
        size,
        number,
        ...(processName ? { processName } : {}),
      });
    }
  }
}

/** Resolves `undefined` when serve-sim no longer keeps the occurrence. */
async function readCrashDetailAsync(
  server: ServeSimServer,
  id: string,
  key: number,
  deadline?: AbortSignal
): Promise<z.infer<typeof DetailSchema> | undefined> {
  const url = new URL(`/crashes/${encodeURIComponent(id)}`, server.url);
  url.searchParams.set('device', server.udid);
  url.searchParams.set('key', String(key));
  const controller = new AbortController();
  try {
    const response = await fetch(url.toString(), {
      redirect: 'error',
      size: MAX_DETAIL_BYTES,
      signal: AbortSignal.any([
        controller.signal,
        AbortSignal.timeout(5_000),
        ...(deadline ? [deadline] : []),
      ]),
      ...(server.token ? { headers: { Authorization: `Bearer ${server.token}` } } : {}),
    });
    if (response.status === 404) {
      return undefined;
    }
    if (!response.ok) {
      throw new Error(`serve-sim crash detail responded ${response.status}`);
    }
    const body = await response.json().catch(err => {
      throw (err as { type?: string }).type === 'max-size'
        ? new UnusableDetailError('Crash detail exceeds 8 MiB')
        : err;
    });
    const detail = DetailSchema.safeParse(body);
    if (!detail.success) {
      throw new UnusableDetailError('Crash detail is not valid');
    }
    if (detail.data.record.id !== id || detail.data.occurrence.key !== key) {
      throw new UnusableDetailError('Crash detail does not match the requested occurrence');
    }
    return detail.data;
  } finally {
    controller.abort();
  }
}
