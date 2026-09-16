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
  packageVersion,
}: {
  port: number;
  turnArgs?: string[];
  metricsCorsArgs?: string[];
  frameAncestorArgs?: string[];
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
  const recording = isAndroid
    ? {
        deviceRunSessionId: getDeviceRunSessionIdOrThrow(env),
        directory: await fs.promises.mkdtemp(path.join(os.tmpdir(), 'android-session-recordings-')),
        controlToken: randomBytes(32).toString('hex'),
      }
    : null;
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

  async function finishHostAsync(): Promise<void> {
    try {
      await (await previewTask)?.closeAsync();
    } catch (err) {
      logger.warn({ err }, `Could not close the ${serverName} preview tunnel.`);
    }
    if (recording) {
      // stopAsync signals the whole process group, including capture's encoder.
      // Finalize the MP4 first; the token protects this route on the preview server.
      try {
        const response = await turtleFetch(
          `http://${WEB_PREVIEW_HOST}:${port}/_eas/android-recording/stop`,
          'POST',
          {
            headers: { Authorization: `Bearer ${recording.controlToken}` },
            timeout: 60_000,
            retries: 0,
          }
        );
        if (!response.ok) {
          throw new Error(`Android recording finalization returned HTTP ${response.status}.`);
        }
      } catch (err) {
        logger.warn({ err }, 'Could not finalize Android recording before shutdown.');
      }
    }
    try {
      await previewServer.stopAsync();
    } catch (err) {
      logger.warn({ err }, `Could not stop the ${serverName} session host.`);
    }
    if (recording) {
      try {
        const recordings = parseDeviceScreenRecordings(
          JSON.parse(
            await fs.promises.readFile(path.join(recording.directory, 'recordings.json'), 'utf8')
          )
        );
        await uploadDeviceRunSessionScreenRecordingsAsync(ctx, {
          logger,
          deviceRunSessionId: recording.deviceRunSessionId,
          recordings,
        });
      } catch (err) {
        logger.warn(
          { err, recordingDirectory: recording.directory },
          'Could not upload the Android session recording.'
        );
      }
    }
  }

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
          baseDomain,
          authtoken: getNgrokAuthtokenOrThrow(env),
          logger,
        });
        let closeTask: Promise<void> | null = null;
        return {
          previewPageUrl: new URL(
            `/simulator-preview/${tunnel.subdomainId}`,
            websiteOrigin(env)
          ).toString(),
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
      return (finishTask ??= finishHostAsync());
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
