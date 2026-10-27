import { type bunyan } from '@expo/logger';
import { type BuildStepEnv } from '@expo/steps';
import { createReadStream } from 'node:fs';
import { mkdtemp, open, rename, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';

import { Sentry } from '../../sentry';
import {
  PackageManager,
  resolveConfiguredPackageManager,
  resolvePackageExec,
} from '../../utils/packageManager';
import { createServeSimPackageSpec } from './deviceSessionHost';
import {
  type DetachedProcessHandle,
  omitNgrokAuthtoken,
  spawnDetached,
} from './remoteDeviceRunSession';
import { SERVE_SIM_STATE_DIR, readServeSimServersAsync } from './serveSimMetricsRecorder';

const POLL_INTERVAL_MS = 2_000;
// While serve-sim runs, an exited follower (stream dropped, capture off) is replaced after this long;
// one that recorded nothing (usually capture off) waits longer, since it may stay off all session.
const FOLLOWER_RESTART_INTERVAL_MS = 10_000;
const IDLE_FOLLOWER_RESTART_INTERVAL_MS = 30_000;
// On stop the follower rebuilds the whole HAR from its entry log; a shorter --flush-ms would not
// shorten that last rebuild, so a large recording gets a longer grace before it is killed.
const FOLLOWER_STOP_GRACE_PERIOD_MS = 60_000;
// HARs holding requests, across the session.
const MAX_RECORDINGS = 20;
// Followers started for one serve-sim server; at the idle interval this covers about an hour.
const MAX_FOLLOWER_STARTS = 120;
const OUTPUT_TAIL_CHARS = 2_000;

type Follower = {
  udid: string;
  filePath: string;
  handle: DetachedProcessHandle;
  startedAt: number;
  /** Set once the follower has exited and holds requests no earlier follower recorded. */
  kept?: boolean;
};

type ServeSimNetworkCaptureSession = {
  logger: bunyan;
  stateDir: string;
  pollIntervalMs: number;
  restartIntervalMs: number;
  idleRestartIntervalMs: number;
  outputDirectory: string;
  command: { command: string; args: string[] };
  env: BuildStepEnv;
  followers: Follower[];
  current: Map<string, Follower>;
  followerStarts: Map<string, number>;
  stoppedRetrying: Set<string>;
  warnedRecordingLimit: boolean;
  fileCounts: Map<string, number>;
  /** Per device, the requests of the exited followers that were kept. */
  keptRequests: Map<string, Set<string>>;
  pollingPromise: Promise<void>;
  abortController: AbortController;
};

export type RecordedNetworkCapture = { udid: string; filePath: string; size: number };

let activeSession: ServeSimNetworkCaptureSession | null = null;

/** serve-sim deletes capture files when capture stops; a `capture har` follower keeps the HAR. */
export namespace ServeSimNetworkCaptureRecorder {
  export async function startAsync({
    logger,
    env,
    packageVersion,
    stateDir = SERVE_SIM_STATE_DIR,
    pollIntervalMs = POLL_INTERVAL_MS,
    restartIntervalMs = FOLLOWER_RESTART_INTERVAL_MS,
    idleRestartIntervalMs = IDLE_FOLLOWER_RESTART_INTERVAL_MS,
  }: {
    logger: bunyan;
    env: BuildStepEnv;
    packageVersion?: string;
    stateDir?: string;
    pollIntervalMs?: number;
    restartIntervalMs?: number;
    idleRestartIntervalMs?: number;
  }): Promise<void> {
    if (activeSession) {
      logger.info('The serve-sim network capture recorder is already running.');
      return;
    }
    const command = resolvePackageExec(resolveConfiguredPackageManager(env, PackageManager.NPM), [
      createServeSimPackageSpec(packageVersion),
    ]);
    const session: ServeSimNetworkCaptureSession = {
      logger,
      stateDir,
      pollIntervalMs,
      restartIntervalMs,
      idleRestartIntervalMs,
      outputDirectory: await mkdtemp(path.join(os.tmpdir(), 'serve-sim-network-capture-')),
      command,
      env: omitNgrokAuthtoken(env),
      followers: [],
      current: new Map(),
      followerStarts: new Map(),
      stoppedRetrying: new Set(),
      warnedRecordingLimit: false,
      fileCounts: new Map(),
      keptRequests: new Map(),
      pollingPromise: Promise.resolve(),
      abortController: new AbortController(),
    };
    activeSession = session;

    logger.info('Started watching serve-sim for network capture.');
    session.pollingPromise = pollServeSimServersAsync(session).catch(err => {
      const error = err instanceof Error ? err : new Error(String(err));
      Sentry.capture('serve-sim network capture poller failed', error);
      logger.warn({ err: error }, 'serve-sim network capture poller failed.');
    });
  }

  /** Never rejects. */
  export async function finishAsync({
    logger,
  }: {
    logger: bunyan;
  }): Promise<{ outputDirectory: string | null; captures: RecordedNetworkCapture[] }> {
    const session = activeSession;
    if (!session) {
      logger.info('The serve-sim network capture recorder is not running.');
      return { outputDirectory: null, captures: [] };
    }
    activeSession = null;

    session.abortController.abort();
    await session.pollingPromise;
    // Stopped together, so the final HAR rebuilds share one grace period.
    await Promise.all(
      session.followers.map(follower =>
        follower.handle.stopAsync().catch(err => {
          logger.warn({ err }, `Could not stop the network capture follower for ${follower.udid}.`);
        })
      )
    );
    const captures: RecordedNetworkCapture[] = [];
    const recorded = new Map<string, Set<string>>();
    for (const follower of session.followers) {
      try {
        if (!(await removeRepeatedRequestsAsync(follower, requestsFor(recorded, follower.udid)))) {
          continue;
        }
      } catch (err) {
        logger.warn(
          { err },
          `Could not remove repeated requests from a network capture for ${follower.udid}; it is kept as recorded.`
        );
      }
      const size = await stat(follower.filePath).then(
        stats => stats.size,
        () => 0
      );
      if (size > 0) {
        captures.push({ udid: follower.udid, filePath: follower.filePath, size });
      }
    }
    for (const follower of session.current.values()) {
      if (!captures.some(capture => capture.udid === follower.udid)) {
        logger.info(
          { output: follower.handle.getOutput().slice(-OUTPUT_TAIL_CHARS) || '<empty>' },
          `No network capture was recorded for ${follower.udid}.`
        );
      }
    }
    return { outputDirectory: session.outputDirectory, captures };
  }
}

async function pollServeSimServersAsync(session: ServeSimNetworkCaptureSession): Promise<void> {
  const { abortController } = session;
  while (!abortController.signal.aborted) {
    for (const server of await readServeSimServersAsync(session.stateDir)) {
      // serve-sim's capture routes require a token, so `capture har` refuses a server without one.
      if (!server.token) {
        continue;
      }
      const key = `${server.udid}\n${server.url}\n${server.token}`;
      try {
        await ensureFollowerAsync(session, key, server.udid);
      } catch (err) {
        session.logger.warn(
          { err },
          `Could not start the network capture follower for ${server.udid}; retrying.`
        );
      }
    }
    await delay(session.pollIntervalMs, undefined, { signal: abortController.signal }).catch(
      () => {}
    );
  }
}

async function ensureFollowerAsync(
  session: ServeSimNetworkCaptureSession,
  key: string,
  udid: string
): Promise<void> {
  const previous = session.current.get(key);
  if (previous) {
    if (previous.handle.getExitError() === undefined) {
      return;
    }
    const recorded = await hasEntriesAsync(previous);
    const interval = recorded ? session.restartIntervalMs : session.idleRestartIntervalMs;
    if (Date.now() - previous.startedAt < interval) {
      return;
    }
  } else {
    // serve-sim restarted with a new token; the old identity's follower is no longer current.
    for (const [otherKey, other] of session.current) {
      if (other.udid === udid) {
        session.current.delete(otherKey);
      }
    }
  }
  // A new follower replays the requests serve-sim already holds, so an exited follower that recorded
  // no new request holds no capture of its own and does not use a recording slot.
  for (const follower of [...session.followers]) {
    if (follower.kept || follower.handle.getExitError() === undefined) {
      continue;
    }
    const keptRequests = requestsFor(session.keptRequests, follower.udid);
    const requests = await readRequestKeysAsync(entriesPathFor(follower));
    if (requests.some(request => request === null || !keptRequests.has(request))) {
      follower.kept = true;
      for (const request of requests) {
        if (request !== null) {
          keptRequests.add(request);
        }
      }
    } else {
      session.followers.splice(session.followers.indexOf(follower), 1);
    }
  }
  if (session.followers.length >= MAX_RECORDINGS) {
    if (!session.warnedRecordingLimit) {
      session.warnedRecordingLimit = true;
      session.logger.warn(
        `Network capture reached its limit of ${MAX_RECORDINGS} recordings; recorded captures will be retained.`
      );
    }
    return;
  }
  const starts = session.followerStarts.get(key) ?? 0;
  if (starts >= MAX_FOLLOWER_STARTS) {
    if (!session.stoppedRetrying.has(key)) {
      session.stoppedRetrying.add(key);
      session.logger.warn(
        { output: previous?.handle.getOutput().slice(-OUTPUT_TAIL_CHARS) || '<empty>' },
        `Stopped retrying network capture for ${udid} after ${MAX_FOLLOWER_STARTS} attempts; recorded captures will be retained.`
      );
    }
    return;
  }
  session.followerStarts.set(key, starts + 1);
  const count = (session.fileCounts.get(udid) ?? 0) + 1;
  session.fileCounts.set(udid, count);
  const filePath = path.join(session.outputDirectory, `${udid}-${count}.har`);
  if (!previous) {
    session.logger.info(`Recording network capture for ${udid}.`);
  }
  const follower: Follower = {
    udid,
    filePath,
    startedAt: Date.now(),
    handle: spawnDetached({
      command: session.command.command,
      args: [...session.command.args, 'capture', 'har', '-o', filePath, '-d', udid],
      env: session.env,
      stopGracePeriodMs: FOLLOWER_STOP_GRACE_PERIOD_MS,
    }),
  };
  session.followers.push(follower);
  session.current.set(key, follower);
}

/** serve-sim writes an empty HAR when recording begins; requests go to `<stem>.entries.ndjson`. */
function entriesPathFor(follower: Follower): string {
  return follower.filePath.replace(/\.har$/, '.entries.ndjson');
}

async function hasEntriesAsync(follower: Follower): Promise<boolean> {
  return await stat(entriesPathFor(follower)).then(
    stats => stats.size > 0,
    () => false
  );
}

function requestsFor(requests: Map<string, Set<string>>, udid: string): Set<string> {
  let forDevice = requests.get(udid);
  if (!forDevice) {
    forDevice = new Set();
    requests.set(udid, forDevice);
  }
  return forDevice;
}

/**
 * A request's identity, as serve-sim's `capture har` matches its replays: request ids restart in
 * every capture session, so the request's start time tells them apart. null when serve-sim did not
 * record an id, so the request cannot be matched.
 */
function requestKey(line: string): string | null {
  try {
    const entry = JSON.parse(line) as {
      _captureId?: unknown;
      _captureStartedAt?: unknown;
      startedDateTime?: unknown;
    };
    if (typeof entry._captureId !== 'string') {
      return null;
    }
    return entry._captureStartedAt !== undefined
      ? `${entry._captureId} ${entry._captureStartedAt}`
      : `${entry._captureId} ${entry.startedDateTime}`;
  } catch {
    return null;
  }
}

/** Streams the entry log, so a large recording never has to fit in memory. */
async function forEachEntryAsync(
  entriesPath: string,
  onEntry: (line: string, offset: number) => void
): Promise<void> {
  // A follower that never began recording leaves no entry log.
  if (
    !(await stat(entriesPath).then(
      () => true,
      () => false
    ))
  ) {
    return;
  }
  const input = createReadStream(entriesPath, { encoding: 'utf8' });
  const lines = createInterface({ input, crlfDelay: Infinity });
  let offset = 0;
  try {
    for await (const line of lines) {
      if (line) {
        onEntry(line, offset);
      }
      offset += Buffer.byteLength(line) + 1;
    }
  } finally {
    lines.close();
    input.destroy();
  }
}

async function readRequestKeysAsync(entriesPath: string): Promise<(string | null)[]> {
  const keys: (string | null)[] = [];
  await forEachEntryAsync(entriesPath, line => keys.push(requestKey(line)));
  return keys;
}

/**
 * Rewrites a stopped follower's HAR without the requests an earlier follower for the device
 * recorded, and adds its requests to `recorded`. Returns false when it holds no new request.
 */
async function removeRepeatedRequestsAsync(
  follower: Follower,
  recorded: Set<string>
): Promise<boolean> {
  const entriesPath = entriesPathFor(follower);
  const entries: { start: number; offset: number; length: number }[] = [];
  const requests: string[] = [];
  let repeated = 0;
  await forEachEntryAsync(entriesPath, (line, offset) => {
    const key = requestKey(line);
    if (key !== null && recorded.has(key)) {
      repeated += 1;
      return;
    }
    if (key !== null) {
      requests.push(key);
    }
    let start = Number.POSITIVE_INFINITY;
    try {
      const parsed = Date.parse(
        (JSON.parse(line) as { startedDateTime?: string }).startedDateTime ?? ''
      );
      if (!Number.isNaN(parsed)) {
        start = parsed;
      }
    } catch {}
    entries.push({ start, offset, length: Buffer.byteLength(line) });
  });
  for (const request of requests) {
    recorded.add(request);
  }
  if (entries.length === 0) {
    return false;
  }
  if (repeated > 0) {
    await writeHarAsync(follower.filePath, entriesPath, entries);
  }
  return true;
}

const HAR_HEADER_BYTES = 4_096;
const HAR_ENTRIES_START = '"entries":[';

/** Rebuilds the HAR from the given entry log lines, in start order as serve-sim writes it. */
async function writeHarAsync(
  harPath: string,
  entriesPath: string,
  entries: { start: number; offset: number; length: number }[]
): Promise<void> {
  // serve-sim writes `{"log":{...,"entries":[` first; its version and creator are kept.
  const har = await open(harPath, 'r');
  let header: string;
  try {
    const buffer = Buffer.alloc(HAR_HEADER_BYTES);
    const { bytesRead } = await har.read(buffer, 0, buffer.length, 0);
    header = buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await har.close();
  }
  const at = header.indexOf(HAR_ENTRIES_START);
  if (at === -1) {
    throw new Error('The HAR does not start like a serve-sim HAR.');
  }
  const tempPath = `${harPath}.deduplicated.tmp`;
  const out = await open(tempPath, 'wx', 0o600);
  const source = await open(entriesPath, 'r');
  try {
    await out.write(Buffer.from(header.slice(0, at + HAR_ENTRIES_START.length)));
    const sorted = [...entries].sort((a, b) => a.start - b.start);
    for (const [index, { offset, length }] of sorted.entries()) {
      const line = Buffer.alloc(length);
      await source.read(line, 0, length, offset);
      await out.write(index > 0 ? Buffer.concat([Buffer.from(','), line]) : line);
    }
    await out.write(Buffer.from(']}}\n'));
  } finally {
    await source.close();
    await out.close();
  }
  await rename(tempPath, harPath);
}
