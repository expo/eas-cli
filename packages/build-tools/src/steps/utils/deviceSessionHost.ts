import { SystemError, UserError } from '@expo/eas-build-job';
import type { bunyan } from '@expo/logger';
import { BuildRuntimePlatform, type BuildStepEnv } from '@expo/steps';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';

import type { CustomBuildContext } from '../../customBuildContext';
import { Sentry } from '../../sentry';
import {
  PackageManager,
  resolveConfiguredPackageManager,
  resolvePackageExec,
} from '../../utils/packageManager';
import { sleepAsync } from '../../utils/retry';
import { turtleFetch } from '../../utils/turtleFetch';
import {
  findUnlistedDeviceScreenRecordingsAsync,
  parseDeviceScreenRecordings,
  uploadDeviceRunSessionScreenRecordingsAsync,
} from './deviceRunSessionScreenRecordings';
import { startDeviceRunSessionScreenshotsAsync } from './deviceRunSessionScreenshots';
import {
  type DetachedProcessHandle,
  type ServeSimLaunchOptions,
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
const SERVE_SIM_MAX_DIMENSION = '1600';
const SERVE_SIM_MJPEG_QUALITY = '0.55';
const SERVE_SIM_VIDEO_BITRATE = '10000000';
const SERVE_SIM_VIDEO_FPS = '60';
const EXPO_DEVICE_HUB_PACKAGE_NAME = 'expo-device-hub';
const EXPO_DEVICE_HUB_MAX_DIMENSION = '960';
const EXPO_DEVICE_HUB_VIDEO_BITRATE = '6000000';
const EXPO_DEVICE_HUB_VIDEO_FPS = '60';
// On SIGTERM the Hub finalizes the recording itself, with this deadline before it force-exits,
// so a stop request that failed here still gets one more chance to write the MP4.
const EXPO_DEVICE_HUB_SIGTERM_FINALIZE_DEADLINE_MS = 60_000;
const EXPO_DEVICE_HUB_EXIT_LEEWAY_MS = 10_000;
const RECORDING_STOP_GRACE_PERIOD_MS =
  EXPO_DEVICE_HUB_SIGTERM_FINALIZE_DEADLINE_MS + EXPO_DEVICE_HUB_EXIT_LEEWAY_MS;
const HOST_OUTPUT_TAIL_CHARS = 8_000;
const WEB_PREVIEW_READY_POLL_INTERVAL_MS = 250;

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

// Website dev servers on expo.test use staging sessions, and CORS matches ports exactly.
const WEBSITE_DEV_ORIGINS = [
  'https://expo.test',
  'https://expo.test:13001',
  ...Array.from({ length: 16 }, (_, index) => `https://expo.test:${13200 + index}`),
];

export function websiteOriginServeSimArgs(env: BuildStepEnv): string[] {
  const origins = new Set([websiteOrigin(env)]);
  if (!env.EXPO_LOCAL && env.EXPO_STAGING) {
    origins.add('https://*.expo.dev');
  }
  if (env.EXPO_LOCAL || env.EXPO_STAGING) {
    for (const origin of WEBSITE_DEV_ORIGINS) {
      origins.add(origin);
    }
  }
  return [...origins].flatMap(origin => ['--cors-origin', origin, '--frame-ancestor', origin]);
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
  websiteArgs = [],
  shareUrl,
  packageVersion,
  launchAppIdentifier,
  launchArgs = [],
  openUrl,
}: {
  port: number;
  turnArgs?: string[];
  websiteArgs?: string[];
  shareUrl?: string;
  packageVersion?: string;
} & ServeSimLaunchOptions): string[] {
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
    ...websiteArgs,
    ...(shareUrl ? ['--share-url', shareUrl] : []),
    ...(launchAppIdentifier ? ['--launch-app-identifier', launchAppIdentifier] : []),
    ...launchArgs.flatMap(argument => ['--launch-arg', argument]),
    ...(openUrl ? ['--open-url', openUrl] : []),
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
    await sleepAsync(WEB_PREVIEW_READY_POLL_INTERVAL_MS);
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
  /**
   * Terminal and idempotent. Never rejects: a failed finalization, host stop or upload is logged
   * and reported, so callers need no error handling around it.
   */
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
    launchAppIdentifier,
    launchArgs,
    openUrl,
  }: {
    runtimePlatform: BuildRuntimePlatform;
    env: BuildStepEnv;
    logger: bunyan;
    timeoutMs: number;
    packageVersion?: string;
  } & ServeSimLaunchOptions
): Promise<DeviceSessionHost> {
  const isAndroid = runtimePlatform === BuildRuntimePlatform.LINUX;
  // Unreachable from the step functions, which reject a non-Darwin launch while parsing.
  // Kept because this function is exported and expo-device-hub cannot launch.
  if (isAndroid && launchAppIdentifier) {
    throw new UserError(
      'EAS_LAUNCH_APPLICATION_INVALID_INPUT',
      `Cannot launch ${launchAppIdentifier}: an application launch runs through serve-sim on an iOS simulator, and this session runs expo-device-hub on ${runtimePlatform}.`
    );
  }
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
          websiteArgs: websiteOriginServeSimArgs(env),
          shareUrl: previewPageUrl,
          launchAppIdentifier,
          launchArgs,
          openUrl,
        })
  );
  logger.info(
    `Launching ${packageSpec} on ${WEB_PREVIEW_HOST}:${port} via ${previewExec.command}.`
  );
  const screenshots = await startDeviceRunSessionScreenshotsAsync(ctx, {
    deviceRunSessionId: getDeviceRunSessionIdOrThrow(env),
    logger,
  });
  let previewServer: DetachedProcessHandle;
  try {
    previewServer = spawnDetached({
      command: previewExec.command,
      args: previewExec.args,
      env: {
        ...env,
        EXPO_DEVICE_HUB_SCREENSHOT_DIRECTORY: screenshots.directory,
        ...(recording ? { EXPO_DEVICE_HUB_RECORDING_CONTROL_TOKEN: recording.controlToken } : {}),
      },
      stopGracePeriodMs: recording ? RECORDING_STOP_GRACE_PERIOD_MS : undefined,
    });
  } catch (error) {
    // Nothing was spawned, so nothing can still write into the directory.
    await screenshots.finishAsync(true);
    throw error;
  }

  let previewToken: string | undefined;
  let previewTask: Promise<DeviceWebPreview> | null = null;
  let finishTask: Promise<void> | null = null;
  let hostReady = false;

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
        screenshots,
        serverName,
        port,
        // A host that never answered /readyz has nothing to finalize or upload.
        recording: hostReady ? recording : null,
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
    hostReady = true;
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
    screenshots,
    serverName,
    port,
    recording,
    logger,
  }: {
    previewTask: Promise<DeviceWebPreview> | null;
    previewServer: DetachedProcessHandle;
    screenshots: { finishAsync(hostStopped: boolean): Promise<void> };
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
      // A preview that failed to open, or was closed by its opener after finish began, has no tunnel left.
      const preview = await previewTask?.catch(() => null);
      await preview?.closeAsync();
    }
  ).catch(err => {
    logger.warn({ err }, `Could not close the ${serverName} preview tunnel within its deadline.`);
  });
  let finalization: AndroidRecordingFinalization | null = null;
  if (recording) {
    // stopAsync signals the whole process group, including capture's encoder.
    // Finalize the MP4 first; the token protects this route on the preview server.
    finalization = await finalizeAndroidRecordingAsync({
      port,
      controlToken: recording.controlToken,
      logger,
    });
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
  await screenshots.finishAsync(hostStopped);
  // A Hub that never recorded has logged its reason and left nothing to upload.
  const captured = finalization !== 'not-recording';
  let uploaded = false;
  if (recording && captured && hostStopped) {
    uploaded = await uploadFinishedAndroidRecordingAsync(ctx, { recording, logger });
  }
  if (recording && captured && (finalization === 'failed' || !uploaded)) {
    // The Hub reports capture failures on stderr; the stop route answers with only a summary.
    logger.warn(
      { hostOutput: previewServer.getOutput().slice(-HOST_OUTPUT_TAIL_CHARS) || '<empty>' },
      'Session host output around the recording failure.'
    );
  }
}

type AndroidRecordingFinalization = 'finalized' | 'not-recording' | 'failed';

async function finalizeAndroidRecordingAsync({
  port,
  controlToken,
  logger,
}: {
  port: number;
  controlToken: string;
  logger: bunyan;
}): Promise<AndroidRecordingFinalization> {
  try {
    const response = await withDeviceRunSessionTimeoutAsync(
      { name: 'Android recording finalization', timeoutMs: 60_000 },
      async signal =>
        await turtleFetch(
          `http://${WEB_PREVIEW_HOST}:${port}/_eas/android-recording/stop`,
          'POST',
          {
            headers: { Authorization: `Bearer ${controlToken}` },
            retries: 0,
            shouldThrowOnNotOk: false,
            signal,
          }
        )
    );
    if (response.status === 409) {
      // The Hub answers 409 with the reason nothing was recorded, such as the emulator count.
      logger.warn(`Android recording was not captured: ${await response.text()}`);
      return 'not-recording';
    }
    if (!response.ok) {
      throw new SystemError(
        `Android recording finalization returned HTTP ${response.status}: ${await response.text()}`
      );
    }
    return 'finalized';
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    Sentry.capture('Could not finalize Android recording before shutdown', error, {
      level: 'warning',
    });
    logger.warn({ err: error }, 'Could not finalize Android recording before shutdown.');
    return 'failed';
  }
}

async function uploadFinishedAndroidRecordingAsync(
  ctx: CustomBuildContext,
  { recording, logger }: { recording: AndroidSessionRecording; logger: bunyan }
): Promise<boolean> {
  try {
    let recordings = parseDeviceScreenRecordings(
      JSON.parse(
        await fs.promises.readFile(path.join(recording.directory, 'recordings.json'), 'utf8')
      )
    );
    if (recordings.length === 0) {
      // recordings.json is written at finish; a killed Hub leaves what it had on disk unlisted.
      recordings = await findUnlistedDeviceScreenRecordingsAsync({
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
      return true;
    }
    return false;
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    Sentry.capture('Could not upload the Android session recording', error, { level: 'warning' });
    logger.warn(
      { err: error, recordingDirectory: recording.directory },
      'Could not upload the Android session recording.'
    );
    return false;
  }
}
