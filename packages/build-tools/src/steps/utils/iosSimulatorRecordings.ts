import { type Env } from '@expo/eas-build-job';
import { type bunyan } from '@expo/logger';
import spawn from '@expo/turtle-spawn';
import { type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { z } from 'zod';

import { Sentry } from '../../sentry';
import { IosSimulatorUtils, type IosSimulatorUuid } from '../../utils/IosSimulatorUtils';

const IOS_SIMULATOR_RECORDING_POLL_INTERVAL_MS = 2_000;
const RECORD_SIM_FINISH_TIMEOUT_MS = 30_000;
const RECORD_SIM_FORCE_STOP_TIMEOUT_MS = 5_000;
const RECORD_SIM_MAX_ATTEMPTS_PER_BOOT = 3;
const RECORD_SIM_COMMAND = 'record-sim';

const RecordingManifestSchema = z.object({
  firstFrameWallClock: z.object({
    unixMs: z.number().int(),
    iso8601: z.string(),
  }),
  hlsVersion: z.number().int().optional(),
  hlsTargetDurationSeconds: z.number().int().optional(),
  hlsMediaSequence: z.number().int().optional(),
  recording: z.string(),
  initSegment: z.string().optional(),
  segments: z.array(
    z.object({
      file: z.string(),
      durationSeconds: z.number(),
    })
  ),
});

type RecordingManifest = z.infer<typeof RecordingManifestSchema>;

type IosSimulatorRecording = {
  id: string;
  udid: IosSimulatorUuid;
  displayName: string;
  outputDirectory: string;
  startedAt: Date;
  getOutput: () => string;
};

type ActiveIosSimulatorRecording = IosSimulatorRecording & {
  recordingProcess: ChildProcess;
  completionPromise: Promise<void>;
};

type IosSimulatorRecordingOutput = {
  path: string;
  metadata: RecordingManifest;
};

type CompletedIosSimulatorRecording = IosSimulatorRecording & {
  output: IosSimulatorRecordingOutput | null;
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

export async function startIosSimulatorRecordingsAsync({
  env,
  logger,
}: {
  env: Env;
  logger: bunyan;
}): Promise<void> {
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

export async function finishIosSimulatorRecordingsAsync({
  logger,
}: {
  logger: bunyan;
}): Promise<CompletedIosSimulatorRecording[]> {
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
      logger.info(`Stopping screen recording for ${recording.displayName}.`);
      recording.recordingProcess.kill('SIGINT');
      const finished = await Promise.race([
        recording.completionPromise.then(() => true),
        setTimeout(RECORD_SIM_FINISH_TIMEOUT_MS, false, { ref: false }),
      ]);
      if (finished) {
        return;
      }

      logger.warn(`Forcing iOS Simulator recording process for ${recording.displayName} to stop.`);
      recording.recordingProcess.kill('SIGKILL');
      const killed = await Promise.race([
        recording.completionPromise.then(() => true),
        setTimeout(RECORD_SIM_FORCE_STOP_TIMEOUT_MS, false, { ref: false }),
      ]);
      if (!killed) {
        logger.warn(
          `iOS Simulator recording process for ${recording.displayName} did not exit after SIGKILL.`
        );
        Sentry.capture(
          `iOS Simulator recording process for ${recording.displayName} did not exit after SIGKILL.`,
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
  return await Promise.all(
    completedRecordings.map(async recording => {
      let output;
      try {
        const manifest = RecordingManifestSchema.parse(
          JSON.parse(await readFile(path.join(recording.outputDirectory, 'session.json'), 'utf-8'))
        );
        const recordingPath = path.join(recording.outputDirectory, manifest.recording);
        await access(recordingPath);
        output = {
          path: recordingPath,
          metadata: manifest,
        };
      } catch {
        output = null;
      }

      return {
        ...recording,
        output,
      };
    })
  );
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
          displayName: device.displayName,
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
    displayName,
  }: {
    udid: IosSimulatorUuid;
    displayName: string;
  }
): Promise<void> {
  const startedAt = new Date();
  const recordingId = randomUUID();
  const outputDirectory = path.join(session.recordingsRootDirectory, recordingId);
  await mkdir(outputDirectory, { recursive: true });

  session.logger.info(`Starting screen recording for ${displayName}.`);
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
        `Screen recording process failed for ${displayName}.`
      );
    })
    .finally(() => {
      session.activeRecordings.delete(udid);
      session.completedRecordings.push({
        id: recordingId,
        udid,
        displayName,
        outputDirectory,
        startedAt,
        getOutput,
      });
    });

  session.activeRecordings.set(udid, {
    id: recordingId,
    udid,
    displayName,
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
