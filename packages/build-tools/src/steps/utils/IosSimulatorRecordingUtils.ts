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

const IOS_SIMULATOR_RECORDING_POLL_INTERVAL_MS = 2_000;
const RECORD_SIM_FINISH_TIMEOUT_MS = 70_000;
const RECORD_SIM_FORCE_STOP_TIMEOUT_MS = 5_000;
const RECORD_SIM_MAX_ATTEMPTS_PER_BOOT = 3;
const RECORD_SIM_COMMAND = 'record-sim';

type IosSimulatorRecording = {
  id: string;
  udid: IosSimulatorUuid;
  deviceName: string;
  runtimeDisplayName: string;
  outputDirectory: string;
  startedAt: Date;
  getOutput: () => string;
};

type ActiveIosSimulatorRecording = IosSimulatorRecording & {
  recordingProcess: ChildProcess;
  completionPromise: Promise<void>;
};

type IosSimulatorRecordingSession = {
  env: Env;
  logger: bunyan;
  recordSimCommand: string;
  recordingsRootDirectory: string;
  activeRecordings: Map<IosSimulatorUuid, ActiveIosSimulatorRecording>;
  completedRecordings: IosSimulatorRecording[];
  recordingFailureCounts: Map<IosSimulatorUuid, number>;
  pollingPromise: Promise<void>;
  abortController: AbortController;
};

let activeIosSimulatorRecordingSession: IosSimulatorRecordingSession | null = null;

export namespace IosSimulatorRecordingUtils {
  export async function startAsync({ env, logger }: { env: Env; logger: bunyan }): Promise<void> {
    if (activeIosSimulatorRecordingSession) {
      logger.info('iOS Simulator screen recording polling is already running.');
      return;
    }

    const recordSimCommand = await resolveRecordSimCommandAsync({ env });
    if (!recordSimCommand) {
      logger.warn(
        'record-sim binary is not available; iOS Simulator screen recordings are disabled.'
      );
      return;
    }

    const recordingsRootDirectory = await mkdtemp(
      path.join(os.tmpdir(), 'ios-simulator-recordings-')
    );
    const session: IosSimulatorRecordingSession = {
      env,
      logger,
      recordSimCommand,
      recordingsRootDirectory,
      activeRecordings: new Map(),
      completedRecordings: [],
      recordingFailureCounts: new Map(),
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
        recording.recordingProcess.kill('SIGINT');
        const finished = await Promise.race([
          recording.completionPromise.then(() => true),
          setTimeout(RECORD_SIM_FINISH_TIMEOUT_MS, false, { ref: false }),
        ]);
        if (finished) {
          return;
        }

        const recordSimOutput = recording.getOutput().trim();
        logger.warn(
          { recordSimOutput },
          `Screen recording for ${recording.deviceName} did not finish within 70 seconds and will be stopped.${
            recordSimOutput
              ? `\nRecent recorder messages:\n${recordSimOutput}`
              : '\nNo recorder messages were captured.'
          }`
        );
        recording.recordingProcess.kill('SIGKILL');
        const killed = await Promise.race([
          recording.completionPromise.then(() => true),
          setTimeout(RECORD_SIM_FORCE_STOP_TIMEOUT_MS, false, { ref: false }),
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
    return completedRecordings.map(recording => ({
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

      const bootedUdids = new Set(bootedDevices.map(device => device.udid));
      for (const udid of session.recordingFailureCounts.keys()) {
        if (!bootedUdids.has(udid)) {
          session.recordingFailureCounts.delete(udid);
        }
      }

      for (const device of bootedDevices) {
        if (
          session.activeRecordings.has(device.udid) ||
          (session.recordingFailureCounts.get(device.udid) ?? 0) >= RECORD_SIM_MAX_ATTEMPTS_PER_BOOT
        ) {
          continue;
        }
        await startIosSimulatorRecordingAsync(session, {
          udid: device.udid,
          deviceName: device.name,
          runtimeDisplayName: device.runtimeDisplayName,
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
  }: {
    udid: IosSimulatorUuid;
    deviceName: string;
    runtimeDisplayName: string;
  }
): Promise<void> {
  const startedAt = new Date();
  const recordingId = randomUUID();
  const outputDirectory = path.join(session.recordingsRootDirectory, recordingId);
  await mkdir(outputDirectory, { recursive: true });

  session.logger.info(`Starting screen recording for ${deviceName}.`);
  const recordingSpawn = spawn(
    session.recordSimCommand,
    ['--udid', udid, '--output', outputDirectory, '--segment-duration', '0'],
    {
      env: session.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  const getOutput = captureProcessOutput(recordingSpawn.child);
  const completionPromise = recordingSpawn
    .then(() => undefined)
    .catch((err: unknown) => {
      session.recordingFailureCounts.set(udid, (session.recordingFailureCounts.get(udid) ?? 0) + 1);
      const error = err instanceof Error ? err : new Error(String(err));
      Sentry.capture('iOS Simulator screen recording process failed', error);
      session.logger.warn(
        { err: error, recordSimOutput: getOutput() },
        `Screen recording process failed for ${deviceName}.`
      );
    })
    .finally(() => {
      session.activeRecordings.delete(udid);
      session.completedRecordings.push({
        id: recordingId,
        udid,
        deviceName,
        runtimeDisplayName,
        outputDirectory,
        startedAt,
        getOutput,
      });
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
  });
}

async function resolveRecordSimCommandAsync({ env }: { env: Env }): Promise<string | null> {
  try {
    await spawn('which', [RECORD_SIM_COMMAND], { env });
    return RECORD_SIM_COMMAND;
  } catch {}

  const packagedRecordSimPath = path.join(__dirname, '..', '..', '..', 'bin', RECORD_SIM_COMMAND);
  try {
    await access(packagedRecordSimPath);
    return packagedRecordSimPath;
  } catch {
    return null;
  }
}

function captureProcessOutput(recordingProcess: ChildProcess): () => string {
  let output = '';
  const appendChunk = (chunk: Buffer | string): void => {
    // Keep enough recorder stderr/stdout for diagnostics without retaining unbounded output.
    output = `${output}${chunk.toString()}`.slice(-16_384);
  };
  recordingProcess.stdout?.on('data', appendChunk);
  recordingProcess.stderr?.on('data', appendChunk);
  return () => output;
}
