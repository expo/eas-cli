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
// While serve-sim runs, an exited follower (capture off, stream dropped) is replaced this often.
const FOLLOWER_RESTART_INTERVAL_MS = 10_000;
const FOLLOWER_STOP_GRACE_PERIOD_MS = 15_000;
const MAX_RECORDINGS = 20;
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
  outputDirectory: string;
  command: { command: string; args: string[] };
  env: BuildStepEnv;
  followers: Follower[];
  current: Map<string, Follower>;
  spawnCounts: Map<string, number>;
  failedAt: Map<string, number>;
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
  }: {
    logger: bunyan;
    env: BuildStepEnv;
    packageVersion?: string;
    stateDir?: string;
    pollIntervalMs?: number;
    restartIntervalMs?: number;
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
      outputDirectory: await mkdtemp(path.join(os.tmpdir(), 'serve-sim-network-capture-')),
      command,
      env,
      followers: [],
      current: new Map(),
      spawnCounts: new Map(),
      failedAt: new Map(),
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
    const captures: RecordedNetworkCapture[] = [];
    for (const follower of session.followers) {
      await follower.handle.stopAsync().catch(err => {
        logger.warn({ err }, `Could not stop the network capture follower for ${follower.udid}.`);
      });
      const size = await recordedSizeAsync(follower);
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
      if (!server.token) {
        continue;
      }
      const key = `${server.udid}\n${server.url}\n${server.token}`;
      const failedAt = session.failedAt.get(key);
      if (failedAt !== undefined && Date.now() - failedAt < session.restartIntervalMs) {
        continue;
      }
      try {
        await ensureFollowerAsync(session, key, server.udid);
        session.failedAt.delete(key);
      } catch (err) {
        session.failedAt.set(key, Date.now());
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
  // Drop an empty previous follower only once its replacement has spawned.
  let emptyPrevious: Follower | undefined;
  if (previous) {
    const exited = previous.handle.getExitError() !== undefined;
    if (!exited || Date.now() - previous.startedAt < session.restartIntervalMs) {
      return;
    }
    if ((await recordedSizeAsync(previous)) === 0) {
      emptyPrevious = previous;
    }
  }
  const listed = emptyPrevious ? session.followers.indexOf(emptyPrevious) : -1;
  if (session.followers.length - (listed >= 0 ? 1 : 0) >= MAX_RECORDINGS) {
    return;
  }
  const count = (session.spawnCounts.get(udid) ?? 0) + 1;
  session.spawnCounts.set(udid, count);
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
    const index = session.followers.indexOf(emptyPrevious);
    if (index >= 0) {
      session.followers.splice(index, 1);
    }
  }
  session.followers.push(follower);
  session.current.set(key, follower);
}

async function recordedSizeAsync(follower: Follower): Promise<number> {
  return await stat(follower.filePath).then(
    stats => stats.size,
    () => 0
  );
}
