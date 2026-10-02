import { type Env } from '@expo/eas-build-job';
import { type bunyan } from '@expo/logger';
import spawn from '@expo/turtle-spawn';
import { type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, mkdir, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';

import { Sentry } from '../../sentry';
import { IosSimulatorUtils, type IosSimulatorUuid } from '../../utils/IosSimulatorUtils';
import {
  PackageManager,
  resolveConfiguredPackageManager,
  resolvePackageExec,
} from '../../utils/packageManager';
import { isProcessGroupRunning, killProcessGroup } from '../../utils/processes';
import { SERVE_SIM_STATE_DIR, readServeSimServersAsync } from './serveSimMetricsRecorder';

const IOS_SIMULATOR_RECORDING_POLL_INTERVAL_MS = 2_000;
// Once the poller stops, each recording stops in parallel within 60 + 130 + 5 + 30 = 225 s.
const SERVE_SIM_START_TIMEOUT_MS = 60_000;
/** serve-sim finalizes an active recording within this grace period after SIGTERM. */
export const SERVE_SIM_STOP_GRACE_PERIOD_MS = 90_000;
const SERVE_SIM_LEASE_FINALIZE_TIMEOUT_MS = 30_000;
// serve-sim may be stopping at the same time: its grace period, the manifest wait, and 10 s.
const SERVE_SIM_FINISH_TIMEOUT_MS =
  SERVE_SIM_STOP_GRACE_PERIOD_MS + SERVE_SIM_LEASE_FINALIZE_TIMEOUT_MS + 10_000;
const SERVE_SIM_FORCE_STOP_TIMEOUT_MS = 5_000;
const SERVE_SIM_RECORDING_STARTED = 'serve-sim:recording-started';
// The serve-sim package the session host started; every recorder runs `record-video` from it.
let serveSimPackageSpec: string | null = null;

type IosSimulatorRecording = {
  id: string;
  udid: IosSimulatorUuid;
  deviceName: string;
  runtimeDisplayName: string;
  outputDirectory: string;
  startedAt: Date;
  getOutput: () => string;
  hasStarted: () => boolean;
};

type ActiveIosSimulatorRecording = IosSimulatorRecording & {
  recordingProcess: ChildProcess;
  completionPromise: Promise<void>;
};

type IosSimulatorRecordingSession = {
  env: Env;
  logger: bunyan;
  recordingsRootDirectory: string;
  activeRecordings: Map<IosSimulatorUuid, ActiveIosSimulatorRecording>;
  completedRecordings: IosSimulatorRecording[];
  recordingFailureCounts: Map<IosSimulatorUuid, number>;
  /** Failed attempts for the whole session; unlike recordingFailureCounts, never reset. */
  failedAttemptCounts: Map<IosSimulatorUuid, number>;
  recordingRetryAt: Map<IosSimulatorUuid, number>;
  serveBearerTokens: Map<IosSimulatorUuid, string>;
  completedServeBearerTokens: Map<IosSimulatorUuid, string>;
  pollingPromise: Promise<void>;
  abortController: AbortController;
};

let activeIosSimulatorRecordingSession: IosSimulatorRecordingSession | null = null;

export namespace IosSimulatorRecordingUtils {
  /** One session host serves every device of a job, so the first package wins. */
  export function useServeSimPackage(packageSpec: string): void {
    serveSimPackageSpec ??= packageSpec;
  }

  export async function startAsync({ env, logger }: { env: Env; logger: bunyan }): Promise<void> {
    if (activeIosSimulatorRecordingSession) {
      logger.info('iOS Simulator screen recording polling is already running.');
      return;
    }

    const recordingsRootDirectory = await mkdtemp(
      path.join(os.tmpdir(), 'ios-simulator-recordings-')
    );
    const session: IosSimulatorRecordingSession = {
      env,
      logger,
      recordingsRootDirectory,
      activeRecordings: new Map(),
      completedRecordings: [],
      recordingFailureCounts: new Map(),
      failedAttemptCounts: new Map(),
      recordingRetryAt: new Map(),
      serveBearerTokens: new Map(),
      completedServeBearerTokens: new Map(),
      pollingPromise: Promise.resolve(),
      abortController: new AbortController(),
    };
    activeIosSimulatorRecordingSession = session;

    logger.info('Started polling iOS Simulators for screen recordings.');
    session.pollingPromise = pollIosSimulatorRecordingsAsync(session).catch(err => {
      const error = err instanceof Error ? err : new Error(String(err));
      Sentry.capture('iOS Simulator screen recording poller failed', error);
      logger.warn({ err: error }, 'iOS Simulator screen recording poller failed.');
    });
  }

  export async function finishAsync({ logger }: { logger: bunyan }): Promise<
    {
      udid: IosSimulatorUuid;
      deviceName: string;
      runtimeDisplayName: string;
      directory: string;
    }[]
  > {
    const session = activeIosSimulatorRecordingSession;
    serveSimPackageSpec = null;
    if (!session) {
      logger.info('No iOS Simulator screen recordings are running.');
      return [];
    }
    activeIosSimulatorRecordingSession = null;

    session.abortController.abort();
    await session.pollingPromise;
    await Promise.all(
      [...session.activeRecordings.values()].map(async recording => {
        logger.info(`Stopping screen recording for ${recording.deviceName}.`);
        const startState = await waitForRecorderStartAsync(recording, SERVE_SIM_START_TIMEOUT_MS);
        if (startState === 'exited') {
          return;
        }
        if (startState === 'timeout') {
          logger.warn(
            { recorderOutput: recording.getOutput().trim() },
            `Screen recording for ${recording.deviceName} did not report its start within ${Math.round(
              SERVE_SIM_START_TIMEOUT_MS / 1_000
            )} seconds and will be stopped.`
          );
        }
        const finishTimeoutMs =
          startState === 'started' ? SERVE_SIM_FINISH_TIMEOUT_MS : SERVE_SIM_FORCE_STOP_TIMEOUT_MS;
        signalRecorder(recording.recordingProcess, 'SIGINT');
        const finished = await Promise.race([
          recording.completionPromise.then(() => true),
          setTimeout(finishTimeoutMs, false, { ref: false }),
        ]);
        if (finished) {
          return;
        }

        const recorderOutput = recording.getOutput().trim();
        const finishTimeoutSeconds = Math.round(finishTimeoutMs / 1_000);
        const stopFailure =
          startState === 'started'
            ? `did not finish within ${finishTimeoutSeconds} seconds`
            : `did not stop within ${finishTimeoutSeconds} seconds of SIGINT`;
        logger.warn(
          { recorderOutput },
          `Screen recording for ${recording.deviceName} ${stopFailure} and will be killed.${
            recorderOutput
              ? `\nRecent recorder messages:\n${recorderOutput}`
              : '\nNo recorder messages were captured.'
          }`
        );
        signalRecorder(recording.recordingProcess, 'SIGKILL');
        const killed = await Promise.race([
          recording.completionPromise.then(() => true),
          setTimeout(SERVE_SIM_FORCE_STOP_TIMEOUT_MS, false, { ref: false }),
        ]);
        if (!killed) {
          logger.warn(
            `iOS Simulator recording process for ${recording.deviceName} did not exit after SIGKILL.`
          );
          // Recorder output stays in the job log: it can contain the serve-sim bearer token.
          Sentry.capture(
            `iOS Simulator recording process for ${recording.deviceName} did not exit after SIGKILL.`
          );
        }
      })
    );

    const completedRecordings = [...session.completedRecordings].sort(
      (a, b) => a.startedAt.getTime() - b.startedAt.getTime()
    );
    const recordingsWithManifests = await Promise.all(
      completedRecordings.map(async recording => {
        if (
          await waitForRecordingManifestAsync(
            recording.outputDirectory,
            SERVE_SIM_LEASE_FINALIZE_TIMEOUT_MS
          )
        ) {
          return recording;
        }
        reportLostRecording(logger, recording.deviceName, recording.getOutput().trim());
        return null;
      })
    );
    const finalizedRecordings = recordingsWithManifests.filter(recording => recording !== null);
    const recordedUdids = new Set(finalizedRecordings.map(recording => recording.udid));
    for (const [failedUdid, attempts] of session.failedAttemptCounts) {
      if (!recordedUdids.has(failedUdid)) {
        Sentry.capture('iOS Simulator screen recording failed on every attempt', {
          level: 'warning',
          extras: { attempts },
        });
      }
    }
    return finalizedRecordings.map(recording => ({
      udid: recording.udid,
      deviceName: recording.deviceName,
      runtimeDisplayName: recording.runtimeDisplayName,
      directory: recording.outputDirectory,
    }));
  }
}

async function pollIosSimulatorRecordingsAsync(
  session: IosSimulatorRecordingSession
): Promise<void> {
  let listDevicesErrorCount = 0;

  const signal = session.abortController.signal;

  while (!signal.aborted) {
    try {
      const bootedDevices = await IosSimulatorUtils.getAvailableDevicesAsync({
        env: session.env,
        filter: 'booted',
      });
      if (signal.aborted) {
        break;
      }
      listDevicesErrorCount = 0;
      const readyServers = new Map(
        (await readServeSimServersAsync(SERVE_SIM_STATE_DIR)).flatMap(server =>
          server.token ? [[server.udid, server.token] as const] : []
        )
      );

      const bootedUdids = new Set(bootedDevices.map(device => device.udid));
      for (const udid of session.serveBearerTokens.keys()) {
        if (!bootedUdids.has(udid)) {
          session.recordingFailureCounts.delete(udid);
          session.recordingRetryAt.delete(udid);
          session.serveBearerTokens.delete(udid);
          session.completedServeBearerTokens.delete(udid);
        }
      }

      for (const device of bootedDevices) {
        const token = readyServers.get(device.udid);
        const packageSpec = serveSimPackageSpec;
        if (!token || !packageSpec) {
          continue;
        }
        if (session.serveBearerTokens.get(device.udid) !== token) {
          session.serveBearerTokens.set(device.udid, token);
          session.recordingFailureCounts.delete(device.udid);
          session.recordingRetryAt.delete(device.udid);
          session.completedServeBearerTokens.delete(device.udid);
        }
        if (
          session.completedServeBearerTokens.get(device.udid) === token ||
          session.activeRecordings.has(device.udid) ||
          Date.now() < (session.recordingRetryAt.get(device.udid) ?? 0)
        ) {
          continue;
        }
        await startIosSimulatorRecordingAsync(session, {
          udid: device.udid,
          deviceName: device.name,
          runtimeDisplayName: device.runtimeDisplayName,
          packageSpec,
        });
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      listDevicesErrorCount += 1;
      if (listDevicesErrorCount === 1 || listDevicesErrorCount % 5 === 0) {
        Sentry.capture('Could not poll iOS Simulators for screen recordings', error);
        session.logger.warn(
          { err: error, failedSimulatorListCount: listDevicesErrorCount },
          'Could not poll iOS Simulators for screen recordings.'
        );
      }
    }

    if (!signal.aborted) {
      try {
        await setTimeout(IOS_SIMULATOR_RECORDING_POLL_INTERVAL_MS, undefined, {
          signal,
        });
      } catch (err) {
        if (!signal.aborted) {
          throw err;
        }
      }
    }
  }
}

async function startIosSimulatorRecordingAsync(
  session: IosSimulatorRecordingSession,
  {
    udid,
    deviceName,
    runtimeDisplayName,
    packageSpec,
  }: {
    udid: IosSimulatorUuid;
    deviceName: string;
    runtimeDisplayName: string;
    packageSpec: string;
  }
): Promise<void> {
  const startedAt = new Date();
  const serveBearerToken = session.serveBearerTokens.get(udid);
  const recordingId = randomUUID();
  const outputDirectory = path.join(session.recordingsRootDirectory, recordingId);
  await mkdir(outputDirectory, { recursive: true });

  session.logger.info(`Starting screen recording for ${deviceName}.`);
  const recorderExec = resolvePackageExec(
    resolveConfiguredPackageManager(session.env, PackageManager.NPM),
    [packageSpec, 'record-video']
  );
  const recordingSpawn = spawn(
    recorderExec.command,
    [...recorderExec.args, '--udid', udid, '--output', outputDirectory],
    {
      env: session.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    }
  );
  const { getOutput, hasStarted } = captureProcessOutput(recordingSpawn.child);
  const saveFinalizedRecordingAsync = async (): Promise<boolean> => {
    if (
      !(await waitForRecordingManifestAsync(outputDirectory, SERVE_SIM_LEASE_FINALIZE_TIMEOUT_MS))
    ) {
      return false;
    }
    if (serveBearerToken) {
      session.completedServeBearerTokens.set(udid, serveBearerToken);
    }
    session.completedRecordings.push({
      id: recordingId,
      udid,
      deviceName,
      runtimeDisplayName,
      outputDirectory,
      startedAt,
      getOutput,
      hasStarted,
    });
    return true;
  };
  const completionPromise = (async () => {
    let spawnError: unknown;
    try {
      await recordingSpawn;
    } catch (err) {
      spawnError = err;
    }
    // A package-manager wrapper can exit while its record-video child still
    // runs in the detached group. Keep this device active until the group exits.
    await waitForRecordingProcessGroupExitAsync(recordingSpawn.child);
    // Host shutdown can end the recorder's lease after its video has been saved.
    if ((hasStarted() || !spawnError) && (await saveFinalizedRecordingAsync())) {
      return;
    }
    if (spawnError) {
      const err = spawnError;
      const error = err instanceof Error ? err : new Error(String(err));
      session.logger.warn(
        { err: error, recorderOutput: getOutput() },
        `Screen recording process failed for ${deviceName}.`
      );
    }
    if (hasStarted()) {
      reportLostRecording(session.logger, deviceName, getOutput().trim());
    } else if (!spawnError) {
      session.logger.warn(
        { recorderOutput: getOutput().trim() },
        `Screen recording for ${deviceName} exited before it started; it will be retried.`
      );
    }
    scheduleRecordingRetry(session, udid);
  })().finally(() => {
    session.activeRecordings.delete(udid);
  });

  session.activeRecordings.set(udid, {
    id: recordingId,
    udid,
    deviceName,
    runtimeDisplayName,
    outputDirectory,
    recordingProcess: recordingSpawn.child,
    completionPromise,
    startedAt,
    getOutput,
    hasStarted,
  });
}

async function waitForRecordingManifestAsync(
  outputDirectory: string,
  timeoutMs: number
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await access(path.join(outputDirectory, 'session.json'));
      return true;
    } catch {
      await setTimeout(1_000);
    }
  }
  return false;
}

async function waitForRecorderStartAsync(
  recording: ActiveIosSimulatorRecording,
  timeoutMs: number
): Promise<'started' | 'exited' | 'timeout'> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (recording.hasStarted()) {
      return 'started';
    }
    const exited = await Promise.race([
      recording.completionPromise.then(() => true),
      setTimeout(100, false),
    ]);
    if (exited) {
      return 'exited';
    }
  }
  return 'timeout';
}

function reportLostRecording(logger: bunyan, deviceName: string, recorderOutput: string): void {
  logger.warn(
    { recorderOutput },
    `Screen recording for ${deviceName} ended without a manifest; its footage cannot be uploaded.`
  );
  Sentry.capture('iOS Simulator screen recording ended without a manifest', {
    level: 'warning',
    extras: { deviceName },
  });
}

function scheduleRecordingRetry(
  session: IosSimulatorRecordingSession,
  udid: IosSimulatorUuid
): void {
  session.failedAttemptCounts.set(udid, (session.failedAttemptCounts.get(udid) ?? 0) + 1);
  const failures = (session.recordingFailureCounts.get(udid) ?? 0) + 1;
  session.recordingFailureCounts.set(udid, failures);
  session.recordingRetryAt.set(
    udid,
    Date.now() + Math.min(300_000, 25_000 * 2 ** Math.min(failures - 1, 4))
  );
}

function signalRecorder(child: ChildProcess, signal: NodeJS.Signals): void {
  // killProcessGroup skips a child without a pid.
  if (child.pid === undefined) {
    child.kill(signal);
    return;
  }
  killProcessGroup(child, signal);
}

async function waitForRecordingProcessGroupExitAsync(child: ChildProcess): Promise<void> {
  if (child.pid === undefined) {
    return;
  }
  // Bounded by finishAsync's SIGKILL; unref'd so it cannot keep the worker alive.
  while (isProcessGroupRunning(child.pid)) {
    await setTimeout(100, undefined, { ref: false });
  }
}

function captureProcessOutput(recordingProcess: ChildProcess): {
  getOutput: () => string;
  hasStarted: () => boolean;
} {
  let output = '';
  let started = false;
  const appendChunk = (chunk: Buffer | string): void => {
    output = `${output}${chunk.toString()}`;
    if (output.includes(SERVE_SIM_RECORDING_STARTED)) {
      started = true;
    }
    output = output.slice(-16_384);
  };
  recordingProcess.stdout?.on('data', appendChunk);
  recordingProcess.stderr?.on('data', appendChunk);
  return { getOutput: () => output, hasStarted: () => started };
}
