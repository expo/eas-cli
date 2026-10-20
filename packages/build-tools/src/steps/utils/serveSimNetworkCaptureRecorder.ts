import { type bunyan } from '@expo/logger';
import { type BuildStepEnv } from '@expo/steps';
import { mkdtemp, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { Sentry } from '../../sentry';
import {
  PackageManager,
  resolveConfiguredPackageManager,
  resolvePackageExec,
} from '../../utils/packageManager';
import { createServeSimPackageSpec } from './deviceSessionHost';
import { type DetachedProcessHandle, spawnDetached } from './remoteDeviceRunSession';
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
  fileCounts: Map<string, number>;
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
      env,
      followers: [],
      current: new Map(),
      followerStarts: new Map(),
      stoppedRetrying: new Set(),
      fileCounts: new Map(),
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
    for (const follower of session.followers) {
      const size = await stat(follower.filePath).then(
        stats => stats.size,
        () => 0
      );
      if (size > 0 && (await hasEntriesAsync(follower))) {
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
  // A previous follower that recorded nothing is dropped once its replacement has spawned.
  let emptyPrevious: Follower | undefined;
  if (previous) {
    if (previous.handle.getExitError() === undefined) {
      return;
    }
    const recorded = await hasEntriesAsync(previous);
    const interval = recorded ? session.restartIntervalMs : session.idleRestartIntervalMs;
    if (Date.now() - previous.startedAt < interval) {
      return;
    }
    if (!recorded) {
      emptyPrevious = previous;
    }
  }
  if (session.followers.length - (emptyPrevious ? 1 : 0) >= MAX_RECORDINGS) {
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
  if (emptyPrevious) {
    session.followers.splice(session.followers.indexOf(emptyPrevious), 1);
  }
  session.followers.push(follower);
  session.current.set(key, follower);
}

/** serve-sim writes an empty HAR when recording begins; requests go to `<stem>.entries.ndjson`. */
async function hasEntriesAsync(follower: Follower): Promise<boolean> {
  return await stat(follower.filePath.replace(/\.har$/, '.entries.ndjson')).then(
    stats => stats.size > 0,
    () => false
  );
}
