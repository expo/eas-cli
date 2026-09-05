import { SystemError } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import { asyncResult } from '@expo/results';
import { BuildRuntimePlatform, BuildStepEnv, spawnAsync } from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import * as ngrok from '@ngrok/ngrok';
import { graphql } from 'gql.tada';
import nullthrows from 'nullthrows';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import { createServer } from 'node:net';
import { clearTimeout, setTimeout } from 'node:timers';
import { setTimeout as setTimeoutAsync } from 'node:timers/promises';

import { CustomBuildContext } from '../../customBuildContext';
import { Sentry } from '../../sentry';
import { sleepAsync } from '../../utils/retry';
import { turtleFetch } from '../../utils/turtleFetch';

const XCODE_DEVELOPER_DIR = '/Applications/Xcode.app/Contents/Developer';
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
const PREVIEW_HOST = /^https:\/\/web-preview-([^./]+)\./;

export function simulatorPreviewUrl(webPreviewUrl: string, env: BuildStepEnv): string {
  const previewId = PREVIEW_HOST.exec(webPreviewUrl)?.[1];
  const websiteBaseUrl = env.EXPO_LOCAL
    ? 'http://expo.test'
    : env.EXPO_STAGING
      ? 'https://staging.expo.dev'
      : 'https://expo.dev';
  return previewId ? `${websiteBaseUrl}/simulator-preview/${previewId}` : webPreviewUrl;
}

const START_DEVICE_RUN_SESSION_MUTATION = graphql(`
  mutation StartDeviceRunSession($deviceRunSessionId: ID!, $remoteConfig: JSONObject!) {
    deviceRunSession {
      startDeviceRunSession(
        deviceRunSessionId: $deviceRunSessionId
        remoteConfig: $remoteConfig
      ) {
        id
        status
      }
    }
  }
`);

const DEVICE_RUN_SESSION_STATUS_QUERY = graphql(`
  query DeviceRunSessionStatus($deviceRunSessionId: ID!) {
    deviceRunSessions {
      byId(deviceRunSessionId: $deviceRunSessionId) {
        id
        status
      }
    }
  }
`);

const ENSURE_DEVICE_RUN_SESSION_STOPPED_MUTATION = graphql(`
  mutation EnsureDeviceRunSessionStopped($deviceRunSessionId: ID!) {
    deviceRunSession {
      ensureDeviceRunSessionStopped(deviceRunSessionId: $deviceRunSessionId) {
        id
        status
      }
    }
  }
`);

const DEVICE_RUN_SESSION_STATUS_POLL_INTERVAL_MS = 5_000;

export function getDeviceRunSessionIdOrThrow(env: BuildStepEnv): string {
  const deviceRunSessionId = env.DEVICE_RUN_SESSION_ID;
  if (!deviceRunSessionId) {
    throw new SystemError(
      'DEVICE_RUN_SESSION_ID is not set. ' +
        'This step must run as part of a device run session ' +
        'which injects DEVICE_RUN_SESSION_ID into the job environment.'
    );
  }
  return deviceRunSessionId;
}

export function getNgrokTunnelDomainOrThrow(env: BuildStepEnv): string {
  const baseDomain = env.EAS_SIMULATOR_NGROK_TUNNEL_DOMAIN;
  if (!baseDomain) {
    throw new SystemError(
      'EAS_SIMULATOR_NGROK_TUNNEL_DOMAIN is not set. ' +
        'This step must run as part of a device run session ' +
        'which injects EAS_SIMULATOR_NGROK_TUNNEL_DOMAIN into the job environment.'
    );
  }
  return baseDomain;
}

export function getNgrokAuthtokenOrThrow(env: BuildStepEnv): string {
  const authtoken = env.NGROK_AUTHTOKEN;
  if (!authtoken) {
    throw new SystemError(
      'NGROK_AUTHTOKEN is not set. ' +
        'This step must run as part of a device run session ' +
        'which injects NGROK_AUTHTOKEN into the job environment.'
    );
  }
  return authtoken;
}

const TurnIceServersSchema = z.array(
  z.object({
    urls: z.array(z.string()),
    username: z.string().optional(),
    credential: z.string().optional(),
  })
);

export type TurnIceServers = z.infer<typeof TurnIceServersSchema>;

export async function selectXcodeDeveloperDirectoryAsync({
  env,
  logger,
}: {
  env: BuildStepEnv;
  logger: bunyan;
}): Promise<void> {
  if (process.env.ENVIRONMENT === 'development') {
    logger.info('Job running outside of EAS, not selecting Xcode developer directory.');
    return;
  }

  logger.info(`Selecting Xcode developer directory: ${XCODE_DEVELOPER_DIR}.`);
  await spawnAsync('sudo', ['xcode-select', '-s', XCODE_DEVELOPER_DIR], {
    env,
    logger,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export type DeviceRunSessionIdleTimeout = {
  /** Stop the session after this many minutes without observed activity. */
  maxIdleTimeMinutes: number;
  /**
   * Local arrival time of the most recent session event, or `undefined` when
   * no event has been observed yet. The idle clock starts when the wait
   * begins, so a session nobody ever connects to still times out.
   */
  getLastEventObservedAt: () => Date | undefined;
};

export async function waitForDeviceRunSessionStoppedAsync({
  ctx,
  deviceRunSessionId,
  logger,
  maxDurationSeconds,
  signal: cancelSignal,
  idleTimeout,
}: {
  ctx: CustomBuildContext;
  deviceRunSessionId: string;
  logger: bunyan;
  maxDurationSeconds?: number;
  signal?: AbortSignal;
  idleTimeout?: DeviceRunSessionIdleTimeout;
}): Promise<void> {
  const durationAbortController = new AbortController();
  const signal = cancelSignal
    ? AbortSignal.any([cancelSignal, durationAbortController.signal])
    : durationAbortController.signal;
  // Nothing to wait for if the step was already aborted before we started;
  // return before logging so we don't claim to be polling a session we never poll.
  if (signal.aborted) {
    return;
  }
  const durationTimeout =
    maxDurationSeconds === undefined
      ? undefined
      : setTimeout(() => {
          logger.info(`Device run session ${deviceRunSessionId} reached its maximum duration.`);
          durationAbortController.abort();
        }, maxDurationSeconds * 1_000);

  try {
    logger.info(
      `Remote session is live. Polling device run session ${deviceRunSessionId} until it is stopped.`
    );
    if (durationTimeout !== undefined) {
      logger.info(
        `The device run session will stop automatically after ${maxDurationSeconds} seconds.`
      );
    }
    if (idleTimeout) {
      logger.info(
        `The session stops automatically after ${idleTimeout.maxIdleTimeMinutes} minute(s) without activity.`
      );
    }
    let pollErrorCount = 0;
    let lastActivityAt = new Date();

    while (!signal.aborted) {
      if (idleTimeout) {
        const lastEventObservedAt = idleTimeout.getLastEventObservedAt();
        if (lastEventObservedAt && lastEventObservedAt > lastActivityAt) {
          lastActivityAt = lastEventObservedAt;
        }
        if (Date.now() - lastActivityAt.getTime() >= idleTimeout.maxIdleTimeMinutes * 60_000) {
          logger.info(
            `Device run session ${deviceRunSessionId} had no activity for ` +
              `${idleTimeout.maxIdleTimeMinutes} minute(s) (max idle time). Stopping the session.`
          );
          await ensureDeviceRunSessionStoppedSafelyAsync({ ctx, deviceRunSessionId, logger });
          return;
        }
      }
      try {
        const result = await ctx.graphqlClient
          .query(DEVICE_RUN_SESSION_STATUS_QUERY, { deviceRunSessionId })
          .toPromise();
        if (result.error) {
          throw result.error;
        }

        const status = result.data?.deviceRunSessions?.byId?.status;
        if (!status) {
          throw new Error(`Device run session ${deviceRunSessionId} status response was missing.`);
        }
        pollErrorCount = 0;
        if (status === 'STOPPED') {
          logger.info(`Device run session ${deviceRunSessionId} was stopped.`);
          return;
        }
        if (status === 'ERRORED') {
          throw new SystemError(`Device run session ${deviceRunSessionId} errored.`);
        }
      } catch (err) {
        if (err instanceof SystemError) {
          throw err;
        }

        const error = err instanceof Error ? err : new Error(String(err));
        pollErrorCount += 1;
        if (pollErrorCount === 1 || pollErrorCount % 5 === 0) {
          Sentry.capture('Could not poll device run session status', error, { level: 'warning' });
          logger.warn(
            { err: error, failedStatusPollCount: pollErrorCount },
            'Could not poll device run session status; will retry.'
          );
        }
      }
      await sleepUntilAbortedAsync(DEVICE_RUN_SESSION_STATUS_POLL_INTERVAL_MS, signal);
    }
  } finally {
    if (durationTimeout !== undefined) {
      clearTimeout(durationTimeout);
    }
  }
}

// Best effort: when this fails, the caller still tears the session down and the
// job run finishes, which clients also treat as the session ending.
async function ensureDeviceRunSessionStoppedSafelyAsync({
  ctx,
  deviceRunSessionId,
  logger,
}: {
  ctx: CustomBuildContext;
  deviceRunSessionId: string;
  logger: bunyan;
}): Promise<void> {
  try {
    const result = await ctx.graphqlClient
      .mutation(ENSURE_DEVICE_RUN_SESSION_STOPPED_MUTATION, { deviceRunSessionId })
      .toPromise();
    if (result.error) {
      throw result.error;
    }
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    Sentry.capture('Could not mark idle device run session as stopped', error, {
      level: 'warning',
      extras: { deviceRunSessionId },
    });
    logger.warn(
      { err: error },
      `Could not mark device run session ${deviceRunSessionId} as stopped. The session job ends anyway.`
    );
  }
}

async function sleepUntilAbortedAsync(
  timeoutMs: number,
  signal: AbortSignal | undefined
): Promise<void> {
  try {
    await setTimeoutAsync(timeoutMs, undefined, signal ? { signal } : undefined);
  } catch (err) {
    if (!signal?.aborted) {
      throw err;
    }
  }
}

// Device-session tools resolve `ffmpeg` from PATH. Spawning it with the step's
// environment rejects with ENOENT when the binary is absent, and running it also
// proves that the installed binary works.
async function isFfmpegAvailableAsync(env: BuildStepEnv): Promise<boolean> {
  return (await asyncResult(spawn('ffmpeg', ['-version'], { env }))).ok;
}

async function installFfmpegWithHomebrewAsync({
  env,
  logger,
}: {
  env: BuildStepEnv;
  logger: bunyan;
}): Promise<void> {
  await spawn('brew', ['install', 'ffmpeg'], {
    env: { ...env, HOMEBREW_NO_AUTO_UPDATE: '1' },
    logger,
  });
}

async function installFfmpegWithAptAsync({
  env,
  logger,
}: {
  env: BuildStepEnv;
  logger: bunyan;
}): Promise<void> {
  const aptEnv = { ...env, DEBIAN_FRONTEND: 'noninteractive' };
  // The worker's package index can be older than the image it booted from, which
  // makes the install 404 on a moved package. Refreshing first avoids that; a
  // failed refresh is not fatal because the existing index may still resolve.
  await asyncResult(spawn('sudo', ['apt-get', 'update'], { env: aptEnv, logger }));
  await spawn('sudo', ['apt-get', 'install', '-y', 'ffmpeg'], { env: aptEnv, logger });
}

let ffmpegSetupPromise: Promise<void> | undefined;

/**
 * Install ffmpeg when the runtime does not already provide it. Device-session
 * tools use it for video encoding on macOS (iOS simulators) and Linux (Android
 * emulators) alike, but the worker images do not ship it yet.
 *
 * Best-effort by design: a failure here is logged and the session continues
 * without FFmpeg-dependent features.
 *
 * The whole body is wrapped because the caller runs this in the background with
 * `void`. There is no unhandledRejection handler in the worker, so a rejection
 * escaping here would crash the process and take the live session with it.
 * `spawn` is not an async function and can throw synchronously, which
 * `asyncResult` cannot catch — it only wraps an already-created promise.
 */
async function ensureFfmpegInstalledAsync({
  runtimePlatform,
  env,
  logger,
}: {
  runtimePlatform: BuildRuntimePlatform;
  env: BuildStepEnv;
  logger: bunyan;
}): Promise<void> {
  try {
    if (await isFfmpegAvailableAsync(env)) {
      logger.info('ffmpeg is already installed.');
      return;
    }

    const isDarwin = runtimePlatform === BuildRuntimePlatform.DARWIN;
    logger.info(
      `ffmpeg is not installed, installing it with ${
        isDarwin ? 'Homebrew' : 'apt'
      } for the device session.`
    );
    if (isDarwin) {
      await installFfmpegWithHomebrewAsync({ env, logger });
    } else {
      await installFfmpegWithAptAsync({ env, logger });
    }
    logger.info('Installed ffmpeg.');
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    Sentry.capture('Could not install ffmpeg for the device session', error, {
      level: 'warning',
    });
    logger.warn(
      { err: error },
      'Could not install ffmpeg. FFmpeg-dependent features may not work in this session.'
    );
  }
}

export async function ensureFfmpegInstalledOnceAsync({
  runtimePlatform,
  env,
  logger,
}: {
  runtimePlatform: BuildRuntimePlatform;
  env: BuildStepEnv;
  logger: bunyan;
}): Promise<void> {
  if (ffmpegSetupPromise) {
    await ffmpegSetupPromise;
    return;
  }

  const setupPromise = ensureFfmpegInstalledAsync({ runtimePlatform, env, logger });
  ffmpegSetupPromise = setupPromise;
  try {
    await setupPromise;
  } finally {
    if (ffmpegSetupPromise === setupPromise) {
      ffmpegSetupPromise = undefined;
    }
  }
}

const TurnIceServersResponseSchema = z.object({
  data: z.object({
    iceServers: TurnIceServersSchema,
  }),
});

/**
 * Translate Cloudflare ICE servers into web preview CLI flags: `--stun-url` (the
 * credential-less entries) and `--turn-url`/`--turn-username`/`--turn-credential`
 * (the entry carrying the short-lived credentials). serve-sim and expo-device-hub
 * intentionally expose the same ICE flag contract.
 */
export function turnIceServersToWebPreviewArgs(iceServers: TurnIceServers): string[] {
  const stunUrls = iceServers
    .filter(server => !server.username && !server.credential)
    .flatMap(server => server.urls);
  const turnServer = iceServers.find(server => server.username && server.credential);

  const args: string[] = [];
  if (stunUrls.length > 0) {
    args.push('--stun-url', stunUrls.join(','));
  }
  if (turnServer?.username && turnServer.credential && turnServer.urls.length > 0) {
    args.push(
      '--turn-url',
      turnServer.urls.join(','),
      '--turn-username',
      turnServer.username,
      '--turn-credential',
      turnServer.credential
    );
  }
  return args;
}

/**
 * Fetch short-lived Cloudflare TURN ICE servers for this job run from www
 * (minted on demand, mirroring how the worker fetches project clone URLs) and
 * translate them into web preview CLI flags.
 *
 * Best-effort: on any failure we log and return [] so the preview server falls
 * back to its built-in P2P/STUN behavior. The credential is passed as a process
 * arg and deliberately not logged (turtle-spawn never logs argv and the worker
 * is single-tenant).
 */
export async function fetchWebPreviewTurnArgsAsync(
  ctx: CustomBuildContext,
  { env, logger }: { env: BuildStepEnv; logger: bunyan }
): Promise<string[]> {
  try {
    const deviceRunSessionId = getDeviceRunSessionIdOrThrow(env);
    const expoApiServerUrl = nullthrows(ctx.env.__API_SERVER_URL, '__API_SERVER_URL is not set');
    const robotAccessToken = nullthrows(
      ctx.job.secrets?.robotAccessToken,
      'robot access token is not set'
    );

    const response = await turtleFetch(
      new URL(
        `/v2/device-run-sessions/${deviceRunSessionId}/turn-ice-servers`,
        expoApiServerUrl
      ).toString(),
      'POST',
      {
        headers: {
          Authorization: `Bearer ${robotAccessToken}`,
        },
        timeout: 5000,
        retries: 1,
        logger,
      }
    );

    const { data } = TurnIceServersResponseSchema.parse(await response.json());
    const args = turnIceServersToWebPreviewArgs(data.iceServers);
    if (args.length > 0) {
      logger.info('Configured the web preview with Cloudflare TURN ICE servers.');
    }
    return args;
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    Sentry.capture('Could not fetch Cloudflare TURN ICE servers', error, { level: 'warning' });
    logger.warn(
      { err: error },
      'Could not fetch Cloudflare TURN ICE servers; the web preview will fall back to P2P/STUN.'
    );
    return [];
  }
}

export async function uploadRemoteSessionConfigAsync({
  ctx,
  deviceRunSessionId,
  remoteConfig,
  logger,
}: {
  ctx: CustomBuildContext;
  deviceRunSessionId: string;
  remoteConfig: Record<string, unknown>;
  logger: bunyan;
}): Promise<void> {
  logger.info(
    `Reporting remote config to the API server (device run session: ${deviceRunSessionId}).`
  );
  const result = await ctx.graphqlClient
    .mutation(START_DEVICE_RUN_SESSION_MUTATION, { deviceRunSessionId, remoteConfig })
    .toPromise();
  if (result.error) {
    throw new SystemError(
      `Failed to start device run session ${deviceRunSessionId}: ${result.error.message}`
    );
  }
}

export type DetachedProcessHandle = {
  /** PID of the directly spawned process, if the OS assigned one. */
  pid: number | undefined;
  getOutput: () => string;
  stopAsync: () => Promise<void>;
};

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function stopDetachedProcessAsync(pid: number | undefined): Promise<void> {
  if (pid === undefined || !isProcessRunning(pid)) {
    return;
  }
  try {
    // spawnDetached creates a dedicated process group. Signaling the group also
    // terminates npx/bunx descendants instead of leaving the actual daemon alive.
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      return;
    }
  }

  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline && isProcessRunning(pid)) {
    await sleepAsync(100);
  }
  if (!isProcessRunning(pid)) {
    return;
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {}
  }
}

export function spawnDetached({
  command,
  args,
  cwd,
  env,
}: {
  command: string;
  args: string[];
  cwd?: string;
  env: BuildStepEnv;
}): DetachedProcessHandle {
  const promise = spawn(command, args, {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  // We don't await the process — it should outlive this step. Failures show
  // up in the captured output; suppress unhandled rejections here.
  promise.catch(() => {});
  promise.child.unref();

  let output = '';
  const appendChunk = (chunk: Buffer | string): void => {
    output += chunk.toString();
  };
  promise.child.stdout?.on('data', appendChunk);
  promise.child.stderr?.on('data', appendChunk);

  const pid = promise.child.pid;
  return {
    pid,
    getOutput: () => output,
    stopAsync: async () => await stopDetachedProcessAsync(pid),
  };
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
  packageVersion,
}: {
  port: number;
  turnArgs?: string[];
  metricsCorsArgs?: string[];
  packageVersion?: string;
}): string[] {
  return [
    '--yes',
    createServeSimPackageSpec(packageVersion),
    '--port',
    String(port),
    '--host',
    WEB_PREVIEW_HOST,
    '--transport',
    'webrtc',
    '--webrtc-codec',
    'vp8',
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
  ];
}

export function createExpoDeviceHubArgs({
  port,
  turnArgs = [],
  packageVersion,
}: {
  port: number;
  turnArgs?: string[];
  packageVersion?: string;
}): string[] {
  return [
    '--yes',
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
    ...turnArgs,
  ];
}

async function findAvailablePortAsync(): Promise<number> {
  const server = createServer();
  server.unref();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, WEB_PREVIEW_HOST, () => resolve());
  });
  const address = server.address();
  await new Promise<void>((resolve, reject) => {
    server.close(err => (err ? reject(err) : resolve()));
  });
  if (!address || typeof address === 'string') {
    throw new SystemError('Could not allocate a local port for the web preview.');
  }
  return address.port;
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
}): Promise<void> {
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
      WebPreviewReadyResponseSchema.parse(await response.json());
      return;
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

export type DeviceWebPreviewHandle = {
  previewUrl: string;
  stopAsync: () => Promise<void>;
};

export type ServeSimPreviewHandle = DeviceWebPreviewHandle;

async function startWebPreviewWithTunnelAsync(
  ctx: CustomBuildContext,
  {
    baseDomain,
    env,
    logger,
    timeoutMs,
    serverName,
    packageSpec,
    createArgs,
  }: {
    baseDomain: string;
    env: BuildStepEnv;
    logger: bunyan;
    timeoutMs: number;
    serverName: string;
    packageSpec: string;
    createArgs: (port: number, turnArgs: string[]) => string[];
  }
): Promise<DeviceWebPreviewHandle> {
  const port = await findAvailablePortAsync();
  logger.info(`Launching ${packageSpec} on ${WEB_PREVIEW_HOST}:${port}.`);
  const turnArgs = await fetchWebPreviewTurnArgsAsync(ctx, { env, logger });
  const previewServer = spawnDetached({
    command: 'npx',
    args: createArgs(port, turnArgs),
    env,
  });

  try {
    logger.info(`Waiting for ${serverName} to become ready.`);
    await waitForWebPreviewReadyAsync({ previewServer, serverName, port, timeoutMs });
    const tunnel = await startNgrokTunnelAsync({
      port,
      subdomainPrefix: 'web-preview',
      baseDomain,
      authtoken: getNgrokAuthtokenOrThrow(env),
      logger,
    });
    logger.info(`Web preview URL: ${simulatorPreviewUrl(tunnel.url, env)}`);
    return {
      previewUrl: tunnel.url,
      stopAsync: async () => {
        const results = await Promise.allSettled([tunnel.stopAsync(), previewServer.stopAsync()]);
        for (const result of results) {
          if (result.status === 'rejected') {
            logger.warn({ err: result.reason }, `Could not stop a ${serverName} preview resource.`);
          }
        }
      },
    };
  } catch (error) {
    await previewServer.stopAsync();
    throw error;
  }
}

export async function startServeSimWithTunnelAsync(
  ctx: CustomBuildContext,
  {
    baseDomain,
    env,
    logger,
    timeoutMs,
    packageVersion,
  }: {
    baseDomain: string;
    env: BuildStepEnv;
    logger: bunyan;
    timeoutMs: number;
    packageVersion?: string;
  }
): Promise<ServeSimPreviewHandle> {
  const metricsCorsArgs = metricsCorsOriginToServeSimArgs(env);
  return await startWebPreviewWithTunnelAsync(ctx, {
    baseDomain,
    env,
    logger,
    timeoutMs,
    serverName: 'serve-sim',
    packageSpec: createServeSimPackageSpec(packageVersion),
    createArgs: (port, turnArgs) =>
      createServeSimArgs({ port, turnArgs, metricsCorsArgs, packageVersion }),
  });
}

export async function startExpoDeviceHubWithTunnelAsync(
  ctx: CustomBuildContext,
  {
    runtimePlatform,
    baseDomain,
    env,
    logger,
    timeoutMs,
    packageVersion,
  }: {
    runtimePlatform: BuildRuntimePlatform;
    baseDomain: string;
    env: BuildStepEnv;
    logger: bunyan;
    timeoutMs: number;
    packageVersion?: string;
  }
): Promise<DeviceWebPreviewHandle> {
  if (runtimePlatform === BuildRuntimePlatform.LINUX) {
    await ensureFfmpegInstalledOnceAsync({ runtimePlatform, env, logger });
  }
  return await startWebPreviewWithTunnelAsync(ctx, {
    baseDomain,
    env,
    logger,
    timeoutMs,
    serverName: 'expo-device-hub',
    packageSpec: createExpoDeviceHubPackageSpec(packageVersion),
    createArgs: (port, turnArgs) => createExpoDeviceHubArgs({ port, turnArgs, packageVersion }),
  });
}

export async function startDeviceWebPreviewWithTunnelAsync(
  ctx: CustomBuildContext,
  {
    runtimePlatform,
    ...options
  }: {
    runtimePlatform: BuildRuntimePlatform;
    baseDomain: string;
    env: BuildStepEnv;
    logger: bunyan;
    timeoutMs: number;
    packageVersion?: string;
  }
): Promise<DeviceWebPreviewHandle> {
  switch (runtimePlatform) {
    case BuildRuntimePlatform.DARWIN:
      return await startServeSimWithTunnelAsync(ctx, options);
    case BuildRuntimePlatform.LINUX:
      return await startExpoDeviceHubWithTunnelAsync(ctx, { ...options, runtimePlatform });
  }
}

export type NgrokTunnelHandle = {
  url: string;
  stopAsync: () => Promise<void>;
};

export async function startNgrokTunnelAsync({
  port,
  subdomainPrefix,
  baseDomain,
  authtoken,
  rewriteHostHeader,
  logger,
}: {
  port: number;
  subdomainPrefix: string;
  baseDomain: string;
  authtoken: string;
  rewriteHostHeader?: boolean;
  logger: bunyan;
}): Promise<NgrokTunnelHandle> {
  const domain = `${subdomainPrefix}-${randomBytes(16).toString('hex')}.${baseDomain}`;
  if (subdomainPrefix === 'web-preview') {
    logger.info(`Starting web preview tunnel -> http://localhost:${port}.`);
  } else {
    logger.info(`Starting ngrok tunnel ${domain} -> http://localhost:${port}.`);
  }
  // Run the ngrok agent in-process via the SDK; it keeps the session alive until
  // the process exits, and the step blocks forever to hold it open.
  const listener = await ngrok.forward({
    addr: port,
    authtoken,
    domain,
    ...(rewriteHostHeader ? { request_header_add: [`Host:localhost:${port}`] } : {}),
  });
  const url = listener.url();
  if (!url) {
    await listener.close();
    throw new SystemError(`ngrok tunnel for ${domain} did not return a public URL.`);
  }
  let stopped = false;
  return {
    url,
    stopAsync: async () => {
      if (stopped) {
        return;
      }
      stopped = true;
      try {
        await listener.close();
      } catch (error) {
        logger.warn({ err: error }, `Could not stop ngrok tunnel ${domain}.`);
      }
    },
  };
}

export async function waitForFileAsync<T>({
  filePath,
  timeoutMs,
  description,
  parse,
}: {
  filePath: string;
  timeoutMs: number;
  description: string;
  parse: (raw: string) => T;
}): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const raw = await fs.promises.readFile(filePath, 'utf8');
      return parse(raw);
    } catch (err) {
      lastError = err;
    }
    await sleepAsync(1_000);
  }
  throw new SystemError(
    `Timed out waiting for ${description} to be ready at ${filePath}${
      lastError instanceof Error ? `: ${lastError.message}` : ''
    }.`
  );
}
