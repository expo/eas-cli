import { SystemError } from '@expo/eas-build-job';
import type { bunyan } from '@expo/logger';
import { BuildRuntimePlatform, type BuildStepEnv } from '@expo/steps';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';

import type { CustomBuildContext } from '../../customBuildContext';
import {
  PackageManager,
  resolveConfiguredPackageManager,
  resolvePackageExec,
} from '../../utils/packageManager';
import { sleepAsync } from '../../utils/retry';
import { turtleFetch } from '../../utils/turtleFetch';
import {
  findPartialDeviceScreenRecordingsAsync,
  parseDeviceScreenRecordings,
  uploadDeviceRunSessionScreenRecordingsAsync,
} from './deviceRunSessionScreenRecordings';
import {
  type DetachedProcessHandle,
  ensureFfmpegInstalledOnceAsync,
  fetchWebPreviewTurnArgsAsync,
  findAvailablePortAsync,
  getDeviceRunSessionIdOrThrow,
  getNgrokAuthtokenOrThrow,
  isProcessRunning,
  spawnDetached,
  startNgrokTunnelAsync,
} from './remoteDeviceRunSession';
import { withDeviceRunSessionTimeoutAsync } from './deviceRunSessionTimeout';
import { SERVE_SIM_STATE_DIR, readServeSimServersAsync } from './serveSimMetricsRecorder';

const WEB_PREVIEW_HOST = '127.0.0.1';
const SERVE_SIM_PACKAGE_NAME = '@expo/serve-sim';
const SERVE_SIM_MAX_DIMENSION = '960';
const SERVE_SIM_MJPEG_QUALITY = '0.55';
const SERVE_SIM_VIDEO_BITRATE = '6000000';
const SERVE_SIM_VIDEO_FPS = '60';
const EXPO_DEVICE_HUB_PACKAGE_NAME = 'expo-device-hub';
const EXPO_DEVICE_HUB_MAX_DIMENSION = '960';
const EXPO_DEVICE_HUB_VIDEO_BITRATE = '6000000';
const EXPO_DEVICE_HUB_VIDEO_FPS = '60';

export function websiteOrigin(env: BuildStepEnv): string {
  return env.EXPO_LOCAL
    ? 'https://expo.test'
    : env.EXPO_STAGING
      ? 'https://staging.expo.dev'
      : 'https://expo.dev';
}

export function simulatorPreviewPageUrl(env: BuildStepEnv, subdomainId: string): string {
  return new URL(`/simulator-preview/${subdomainId}`, websiteOrigin(env)).toString();
}

export function metricsCorsOriginToServeSimArgs(env: BuildStepEnv): string[] {
  const origin = env.EAS_SIMULATOR_METRICS_CORS_ORIGIN;
  if (!origin) {
    return [];
  }
  const args: string[] = [];
  for (const value of origin.split(',')) {
    const trimmed = value.trim();
    if (trimmed) {
      args.push('--metrics-cors-origin', trimmed);
    }
  }
  return args;
}

function createServeSimPackageSpec(packageVersion: string | undefined): string {
  return `${SERVE_SIM_PACKAGE_NAME}@${packageVersion ?? 'latest'}`;
}

function createExpoDeviceHubPackageSpec(packageVersion: string | undefined): string {
  return `${EXPO_DEVICE_HUB_PACKAGE_NAME}@${packageVersion ?? 'latest'}`;
}

export function createServeSimArgs({
  port,
  turnArgs = [],
  metricsCorsArgs = [],
  frameAncestorArgs = [],
  shareUrl,
  packageVersion,
}: {
  port: number;
  turnArgs?: string[];
  metricsCorsArgs?: string[];
  frameAncestorArgs?: string[];
  shareUrl?: string;
  packageVersion?: string;
}): string[] {
  return [
    createServeSimPackageSpec(packageVersion),
    '--port',
    String(port),
    '--host',
    WEB_PREVIEW_HOST,
    '--require-token',
    '--transport',
    'webrtc',
    '--webrtc-codec',
    'h264',
    '--max-dimension',
    SERVE_SIM_MAX_DIMENSION,
    '--mjpeg-quality',
    SERVE_SIM_MJPEG_QUALITY,
    '--video-bitrate',
    SERVE_SIM_VIDEO_BITRATE,
    '--video-fps',
    SERVE_SIM_VIDEO_FPS,
    ...turnArgs,
    ...metricsCorsArgs,
    ...frameAncestorArgs,
    ...(shareUrl ? ['--share-url', shareUrl] : []),
  ];
}

export function createExpoDeviceHubArgs({
  port,
  turnArgs = [],
  packageVersion,
  recordingDirectory,
}: {
  port: number;
  turnArgs?: string[];
  packageVersion?: string;
  recordingDirectory?: string;
}): string[] {
  return [
    createExpoDeviceHubPackageSpec(packageVersion),
    '--port',
    String(port),
    '--host',
    WEB_PREVIEW_HOST,
    '--platform',
    'android',
    '--transport',
    'webrtc',
    '--webrtc-codec',
    'h264',
    '--webrtc-ice-policy',
    'all',
    '--max-dimension',
    EXPO_DEVICE_HUB_MAX_DIMENSION,
    '--video-bitrate',
    EXPO_DEVICE_HUB_VIDEO_BITRATE,
    '--video-fps',
    EXPO_DEVICE_HUB_VIDEO_FPS,
    '--hide-sidebar',
    '--hide-boot-device',
    ...(recordingDirectory ? ['--android-recording-directory', recordingDirectory] : []),
    ...turnArgs,
  ];
}

const WebPreviewReadyResponseSchema = z.object({
  status: z.literal('ready'),
  device: z.string(),
});

export async function waitForWebPreviewReadyAsync({
  previewServer,
  serverName,
  port,
  timeoutMs,
}: {
  previewServer: Pick<DetachedProcessHandle, 'pid' | 'getOutput'>;
  serverName: string;
  port: number;
  timeoutMs: number;
}): Promise<string> {
  const readyUrl = `http://${WEB_PREVIEW_HOST}:${port}/readyz`;
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    if (previewServer.pid !== undefined && !isProcessRunning(previewServer.pid)) {
      throw new SystemError(
        `${serverName} exited before becoming ready. Last output:\n${
          previewServer.getOutput() || '<empty>'
        }`
      );
    }
    try {
      const response = await turtleFetch(readyUrl, 'GET', {
        retries: 0,
        timeout: 2_000,
      });
      const ready = WebPreviewReadyResponseSchema.parse(await response.json());
      return ready.device;
    } catch (error) {
      lastError = error;
    }
    await sleepAsync(1_000);
  }
  throw new SystemError(
    `Timed out waiting for ${serverName} readiness at ${readyUrl}${
      lastError instanceof Error ? `: ${lastError.message}` : ''
    }. Last output:\n${previewServer.getOutput() || '<empty>'}`
  );
}

export async function readServeSimPreviewTokenAsync(
  udid: string,
  stateDir: string = SERVE_SIM_STATE_DIR
): Promise<string | undefined> {
  const servers = await readServeSimServersAsync(stateDir);
  return servers.find(server => server.udid === udid)?.token;
}

export type DeviceWebPreview = {
  previewPageUrl: string;
  apiUrl: string;
  previewToken?: string;
  /** Closes this tunnel only. The session host and recording remain running. */
  closeAsync(): Promise<void>;
};

export type DeviceSessionHost = {
  openPreviewAsync(options: { baseDomain: string }): Promise<DeviceWebPreview>;
  /** Terminal and idempotent, including when recording finalization or upload fails. */
  finishAsync(): Promise<void>;
};

type AndroidSessionRecording = {
  deviceRunSessionId: string;
  directory: string;
  controlToken: string;
  env: BuildStepEnv;
};

export async function startDeviceSessionHostAsync(
  ctx: CustomBuildContext,
  {
    runtimePlatform,
    env,
    logger,
    timeoutMs,
    packageVersion,
  }: {
    runtimePlatform: BuildRuntimePlatform;
    env: BuildStepEnv;
    logger: bunyan;
    timeoutMs: number;
    packageVersion?: string;
  }
): Promise<DeviceSessionHost> {
  const isAndroid = runtimePlatform === BuildRuntimePlatform.LINUX;
  if (isAndroid) {
    await ensureFfmpegInstalledOnceAsync({ runtimePlatform, env, logger });
  }
  const recording: AndroidSessionRecording | null = isAndroid
    ? {
        deviceRunSessionId: getDeviceRunSessionIdOrThrow(env),
        directory: await fs.promises.mkdtemp(path.join(os.tmpdir(), 'android-session-recordings-')),
        controlToken: randomBytes(32).toString('hex'),
        env,
      }
    : null;
  const subdomainId = randomBytes(16).toString('hex');
  const previewPageUrl = simulatorPreviewPageUrl(env, subdomainId);
  const port = await findAvailablePortAsync();
  const serverName = isAndroid ? 'expo-device-hub' : 'serve-sim';
  const packageSpec = isAndroid
    ? createExpoDeviceHubPackageSpec(packageVersion)
    : createServeSimPackageSpec(packageVersion);
  const turnArgs = await fetchWebPreviewTurnArgsAsync(ctx, { env, logger });
  const previewExec = resolvePackageExec(
    resolveConfiguredPackageManager(env, PackageManager.NPM),
    isAndroid
      ? createExpoDeviceHubArgs({
          port,
          turnArgs,
          packageVersion,
          recordingDirectory: recording?.directory,
        })
      : createServeSimArgs({
          port,
          turnArgs,
          packageVersion,
          metricsCorsArgs: metricsCorsOriginToServeSimArgs(env),
          frameAncestorArgs: ['--frame-ancestor', websiteOrigin(env)],
          shareUrl: previewPageUrl,
        })
  );
  logger.info(
    `Launching ${packageSpec} on ${WEB_PREVIEW_HOST}:${port} via ${previewExec.command}.`
  );
  const previewServer = spawnDetached({
    command: previewExec.command,
    args: previewExec.args,
    env: recording
      ? { ...env, EXPO_DEVICE_HUB_RECORDING_CONTROL_TOKEN: recording.controlToken }
      : env,
    stopGracePeriodMs: recording ? 70_000 : undefined,
  });

  let previewToken: string | undefined;
  let previewTask: Promise<DeviceWebPreview> | null = null;
  let finishTask: Promise<void> | null = null;

  const host: DeviceSessionHost = {
    openPreviewAsync({ baseDomain }) {
      if (finishTask) {
        return Promise.reject(
          new SystemError('Cannot open a preview after session host finalization.')
        );
      }
      if (previewTask) {
        return previewTask;
      }
      const opening = (async (): Promise<DeviceWebPreview> => {
        const tunnel = await startNgrokTunnelAsync({
          port,
          subdomainPrefix: 'web-preview',
          subdomainId,
          baseDomain,
          authtoken: getNgrokAuthtokenOrThrow(env),
          logger,
        });
        if (finishTask) {
          await withDeviceRunSessionTimeoutAsync(
            { name: 'Late preview tunnel close', timeoutMs: 5_000 },
            async () => await tunnel.stopAsync()
          ).catch(err => logger.warn({ err }, 'Could not close a late preview tunnel.'));
          throw new SystemError('Session host finalized while the preview was opening.');
        }
        let closeTask: Promise<void> | null = null;
        return {
          previewPageUrl,
          apiUrl: tunnel.url,
          previewToken,
          closeAsync() {
            return (closeTask ??= (async () => {
              try {
                await tunnel.stopAsync();
              } finally {
                if (previewTask === opening) {
                  previewTask = null;
                }
              }
            })());
          },
        };
      })();
      previewTask = opening;
      // A failed tunnel may be retried without restarting capture.
      void opening.catch(() => {
        if (previewTask === opening) {
          previewTask = null;
        }
      });
      return opening;
    },
    finishAsync() {
      return (finishTask ??= finishDeviceSessionHostAsync(ctx, {
        previewTask,
        previewServer,
        serverName,
        port,
        recording,
        logger,
      }));
    },
  };
  try {
    logger.info(`Waiting for ${serverName} to become ready.`);
    const device = await waitForWebPreviewReadyAsync({
      previewServer,
      serverName,
      port,
      timeoutMs,
    });
    if (!isAndroid) {
      previewToken = await readServeSimPreviewTokenAsync(device);
      if (!previewToken) {
        throw new SystemError(
          `serve-sim became ready but wrote no session token for device ${device}. The preview is ` +
            'on a public tunnel and would be reachable without one, so the session cannot continue. ' +
            'This usually means the state file was not written as expected; retry the session, and ' +
            'report it if it repeats.'
        );
      }
    }
    return host;
  } catch (error) {
    await host.finishAsync();
    throw error;
  }
}

async function finishDeviceSessionHostAsync(
  ctx: CustomBuildContext,
  {
    previewTask,
    previewServer,
    serverName,
    port,
    recording,
    logger,
  }: {
    previewTask: Promise<DeviceWebPreview> | null;
    previewServer: DetachedProcessHandle;
    serverName: string;
    port: number;
    recording: AndroidSessionRecording | null;
    logger: bunyan;
  }
): Promise<void> {
  // Native ngrok operations have no scoped cancellation. Retire a late listener too.
  const retirePreview = withDeviceRunSessionTimeoutAsync(
    { name: 'Preview tunnel retirement', timeoutMs: 5_000 },
    async () => {
      await (await previewTask)?.closeAsync();
    }
  ).catch(err => {
    logger.warn({ err }, `Could not close the ${serverName} preview tunnel within its deadline.`);
  });
  if (recording) {
    // stopAsync signals the whole process group, including capture's encoder.
    // Finalize the MP4 first; the token protects this route on the preview server.
    await finalizeAndroidRecordingAsync({ port, controlToken: recording.controlToken, logger });
  }
  let hostStopped = false;
  try {
    await previewServer.stopAsync();
    if (previewServer.pid !== undefined && isProcessRunning(previewServer.pid)) {
      throw new Error('Session host is still running after shutdown.');
    }
    hostStopped = true;
  } catch (err) {
    logger.warn({ err }, `Could not stop the ${serverName} session host.`);
  }
  await retirePreview;
  if (recording && hostStopped) {
    await uploadFinishedAndroidRecordingAsync(ctx, { recording, logger });
  }
}

async function finalizeAndroidRecordingAsync({
  port,
  controlToken,
  logger,
}: {
  port: number;
  controlToken: string;
  logger: bunyan;
}): Promise<void> {
  try {
    const response = await withDeviceRunSessionTimeoutAsync(
      { name: 'Android recording finalization', timeoutMs: 60_000 },
      async signal =>
        await turtleFetch(
          `http://${WEB_PREVIEW_HOST}:${port}/_eas/android-recording/stop`,
          'POST',
          {
            headers: { Authorization: `Bearer ${controlToken}` },
            timeout: 60_000,
            retries: 0,
            signal,
          }
        )
    );
    if (!response.ok) {
      throw new Error(`Android recording finalization returned HTTP ${response.status}.`);
    }
  } catch (err) {
    logger.warn({ err }, 'Could not finalize Android recording before shutdown.');
  }
}

async function uploadFinishedAndroidRecordingAsync(
  ctx: CustomBuildContext,
  { recording, logger }: { recording: AndroidSessionRecording; logger: bunyan }
): Promise<void> {
  try {
    let recordings = parseDeviceScreenRecordings(
      JSON.parse(
        await fs.promises.readFile(path.join(recording.directory, 'recordings.json'), 'utf8')
      )
    );
    if (recordings.length === 0) {
      recordings = await findPartialDeviceScreenRecordingsAsync({
        root: recording.directory,
        env: recording.env,
        logger,
      });
    }
    for (const item of recordings) {
      if (
        path.dirname(path.resolve(item.directory)) !== recording.directory ||
        (await fs.promises.lstat(item.directory)).isSymbolicLink()
      ) {
        throw new Error('Recording directory is not an owned session child.');
      }
    }
    const uploaded = await uploadDeviceRunSessionScreenRecordingsAsync(ctx, {
      logger,
      deviceRunSessionId: recording.deviceRunSessionId,
      recordings,
    });
    if (recordings.length > 0 && uploaded) {
      await fs.promises.rm(recording.directory, { recursive: true });
    }
  } catch (err) {
    logger.warn(
      { err, recordingDirectory: recording.directory },
      'Could not upload the Android session recording.'
    );
  }
}
