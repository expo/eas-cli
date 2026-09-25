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
import { SERVE_SIM_STATE_DIR, readServeSimServersAsync } from './serveSimMetricsRecorder';

const IOS_SIMULATOR_RECORDING_POLL_INTERVAL_MS = 2_000;
const SERVE_SIM_START_TIMEOUT_MS = 60_000;
const SERVE_SIM_FINISH_TIMEOUT_MS = 130_000;
const SERVE_SIM_FORCE_STOP_TIMEOUT_MS = 5_000;
const SERVE_SIM_LEASE_FINALIZE_TIMEOUT_MS = 30_000;
const SERVE_SIM_RECORDING_STARTED = 'serve-sim:recording-started';
const serveSimPackageSpecs = new Map<string, string>();

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
  recordingRetryAt: Map<IosSimulatorUuid, number>;
  serverTokens: Map<IosSimulatorUuid, string>;
  completedServerTokens: Map<IosSimulatorUuid, string>;
  pollingPromise: Promise<void>;
  abortController: AbortController;
};

let activeIosSimulatorRecordingSession: IosSimulatorRecordingSession | null = null;

export namespace IosSimulatorRecordingUtils {
  export function registerServeSimPackage(udid: string, packageSpec: string): void {
    serveSimPackageSpecs.set(udid, packageSpec);
  }

  export function unregisterServeSimPackage(udid: string, packageSpec: string): void {
    if (serveSimPackageSpecs.get(udid) === packageSpec) {
      serveSimPackageSpecs.delete(udid);
    }
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
      recordingRetryAt: new Map(),
      serverTokens: new Map(),
      completedServerTokens: new Map(),
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
        const finishTimeoutMs =
          startState === 'started' ? SERVE_SIM_FINISH_TIMEOUT_MS : SERVE_SIM_FORCE_STOP_TIMEOUT_MS;
        signalRecordingProcess(recording.recordingProcess, 'SIGINT');
        const finished = await Promise.race([
          recording.completionPromise.then(() => true),
          setTimeout(finishTimeoutMs, false, { ref: false }),
        ]);
        if (finished) {
          return;
        }

        const recorderOutput = recording.getOutput().trim();
        const finishTimeoutSeconds = Math.round(finishTimeoutMs / 1_000);
        logger.warn(
          { recorderOutput },
          `Screen recording for ${recording.deviceName} did not finish within ${finishTimeoutSeconds} seconds and will be stopped.${
            recorderOutput
              ? `\nRecent recorder messages:\n${recorderOutput}`
              : '\nNo recorder messages were captured.'
          }`
        );
        signalRecordingProcess(recording.recordingProcess, 'SIGKILL');
        const killed = await Promise.race([
          recording.completionPromise.then(() => true),
          setTimeout(SERVE_SIM_FORCE_STOP_TIMEOUT_MS, false, { ref: false }),
        ]);
        if (!killed) {
          logger.warn(
            `iOS Simulator recording process for ${recording.deviceName} did not exit after SIGKILL.`
          );
          Sentry.capture(
            `iOS Simulator recording process for ${recording.deviceName} did not exit after SIGKILL.`,
            {
              extras: {
                output: recording.getOutput(),
              },
            }
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
        logger.warn(
          { recorderOutput: recording.getOutput().trim() },
          `Screen recording for ${recording.deviceName} has no manifest; skipping upload.`
        );
        return null;
      })
    );
    return recordingsWithManifests
      .filter(recording => recording !== null)
      .map(recording => ({
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
      for (const udid of session.serverTokens.keys()) {
        if (!bootedUdids.has(udid)) {
          session.recordingFailureCounts.delete(udid);
          session.recordingRetryAt.delete(udid);
          session.serverTokens.delete(udid);
          session.completedServerTokens.delete(udid);
        }
      }

      for (const device of bootedDevices) {
        const token = readyServers.get(device.udid);
        const packageSpec = serveSimPackageSpecs.get(device.udid);
        if (!token || !packageSpec) {
          continue;
        }
        if (session.serverTokens.get(device.udid) !== token) {
          session.serverTokens.set(device.udid, token);
          session.recordingFailureCounts.delete(device.udid);
          session.recordingRetryAt.delete(device.udid);
          session.completedServerTokens.delete(device.udid);
        }
        if (
          session.completedServerTokens.get(device.udid) === token ||
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
  const serverToken = session.serverTokens.get(udid);
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
    if (serverToken) {
      session.completedServerTokens.set(udid, serverToken);
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
  const completionPromise = recordingSpawn
    .then(async () => {
      if (!(await saveFinalizedRecordingAsync())) {
        scheduleRecordingRetry(session, udid);
      }
    })
    .catch(async (err: unknown) => {
      const error = err instanceof Error ? err : new Error(String(err));
      Sentry.capture('iOS Simulator screen recording process failed', error);
      session.logger.warn(
        { err: error, recorderOutput: getOutput() },
        `Screen recording process failed for ${deviceName}.`
      );
      if (!hasStarted() || !(await saveFinalizedRecordingAsync())) {
        scheduleRecordingRetry(session, udid);
      }
    })
    .finally(() => {
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

function scheduleRecordingRetry(
  session: IosSimulatorRecordingSession,
  udid: IosSimulatorUuid
): void {
  const failures = (session.recordingFailureCounts.get(udid) ?? 0) + 1;
  session.recordingFailureCounts.set(udid, failures);
  session.recordingRetryAt.set(
    udid,
    Date.now() + Math.min(300_000, 25_000 * 2 ** Math.min(failures - 1, 4))
  );
}

function signalRecordingProcess(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid !== undefined) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {}
  }
  child.kill(signal);
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
