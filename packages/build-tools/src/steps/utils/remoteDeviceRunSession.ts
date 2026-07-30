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
const SERVE_SIM_PACKAGE_SPEC = '@expo/serve-sim@latest';
const SERVE_SIM_HOST = '127.0.0.1';
const SERVE_SIM_MAX_DIMENSION = '1280';
const SERVE_SIM_MJPEG_QUALITY = '0.55';
const SERVE_SIM_VIDEO_BITRATE = '3000000';
const SERVE_SIM_VIDEO_FPS = '60';

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

export async function waitForDeviceRunSessionStoppedAsync({
  ctx,
  deviceRunSessionId,
  logger,
  maxDurationSeconds,
  signal: cancelSignal,
}: {
  ctx: CustomBuildContext;
  deviceRunSessionId: string;
  logger: bunyan;
  maxDurationSeconds?: number;
  signal?: AbortSignal;
}): Promise<void> {
  const durationAbortController = new AbortController();
  const signal = cancelSignal
    ? AbortSignal.any([cancelSignal, durationAbortController.signal])
    : durationAbortController.signal;
  const durationTimeout =
    maxDurationSeconds === undefined || signal.aborted
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
    let pollErrorCount = 0;

    while (!signal.aborted) {
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

// Argent encodes screen recordings by piping simulator frames into `ffmpeg`,
// which it resolves from PATH. The tool-server inherits this step's env, so
// spawning ffmpeg resolves against the same PATH argent will search: it rejects
// with ENOENT when the binary is absent, and running it also proves it works.
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

/**
 * Install ffmpeg when the runtime does not already provide it, so argent's
 * `screen-recording-start` tool can encode a video. The worker images do not
 * ship ffmpeg yet, so without this the tool fails with "`ffmpeg` was not found
 * on PATH" — on macOS (iOS simulators) and Linux (Android emulators) alike.
 *
 * Best-effort by design: screen recording is one optional argent tool, so a
 * failure here is logged and the session continues without it.
 *
 * The whole body is wrapped because the caller runs this in the background with
 * `void`. There is no unhandledRejection handler in the worker, so a rejection
 * escaping here would crash the process and take the live session with it.
 * `spawn` is not an async function and can throw synchronously, which
 * `asyncResult` cannot catch — it only wraps an already-created promise.
 */
export async function ensureFfmpegInstalledAsync({
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
      } for argent screen recording.`
    );
    if (isDarwin) {
      await installFfmpegWithHomebrewAsync({ env, logger });
    } else {
      await installFfmpegWithAptAsync({ env, logger });
    }
    logger.info('Installed ffmpeg.');
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    Sentry.capture('Could not install ffmpeg for argent screen recording', error, {
      level: 'warning',
    });
    logger.warn(
      { err: error },
      'Could not install ffmpeg. Argent screen recording will not work in this session.'
    );
  }
}

const TurnIceServersResponseSchema = z.object({
  data: z.object({
    iceServers: TurnIceServersSchema,
  }),
});

/**
 * Translate Cloudflare ICE servers into serve-sim CLI flags: `--stun-url` (the
 * credential-less entries) and `--turn-url`/`--turn-username`/`--turn-credential`
 * (the entry carrying the short-lived credentials).
 */
export function turnIceServersToServeSimArgs(iceServers: TurnIceServers): string[] {
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
 * translate them into serve-sim CLI flags.
 *
 * Best-effort: on any failure we log and return [] so serve-sim falls back to
 * its built-in P2P/STUN behavior. The credential is passed to serve-sim as a
 * process arg and deliberately not logged (turtle-spawn never logs argv and the
 * worker is single-tenant).
 */
export async function fetchServeSimTurnArgsAsync(
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
    const args = turnIceServersToServeSimArgs(data.iceServers);
    if (args.length > 0) {
      logger.info('Configured serve-sim with Cloudflare TURN ICE servers.');
    }
    return args;
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    Sentry.capture('Could not fetch Cloudflare TURN ICE servers', error, { level: 'warning' });
    logger.warn(
      { err: error },
      'Could not fetch Cloudflare TURN ICE servers; serve-sim will fall back to P2P/STUN.'
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

export function createServeSimArgs({
  port,
  turnArgs = [],
}: {
  port: number;
  turnArgs?: string[];
}): string[] {
  return [
    '--yes',
    SERVE_SIM_PACKAGE_SPEC,
    '--port',
    String(port),
    '--host',
    SERVE_SIM_HOST,
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
  ];
}

async function findAvailablePortAsync(): Promise<number> {
  const server = createServer();
  server.unref();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, SERVE_SIM_HOST, () => resolve());
  });
  const address = server.address();
  await new Promise<void>((resolve, reject) => {
    server.close(err => (err ? reject(err) : resolve()));
  });
  if (!address || typeof address === 'string') {
    throw new SystemError('Could not allocate a local port for serve-sim.');
  }
  return address.port;
}

const ServeSimReadyResponseSchema = z.object({
  status: z.literal('ready'),
  device: z.string(),
});

export async function waitForServeSimReadyAsync({
  serveSim,
  port,
  timeoutMs,
}: {
  serveSim: Pick<DetachedProcessHandle, 'pid' | 'getOutput'>;
  port: number;
  timeoutMs: number;
}): Promise<void> {
  const readyUrl = `http://${SERVE_SIM_HOST}:${port}/readyz`;
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    if (serveSim.pid !== undefined && !isProcessRunning(serveSim.pid)) {
      throw new SystemError(
        `serve-sim exited before becoming ready. Last output:\n${serveSim.getOutput() || '<empty>'}`
      );
    }
    try {
      const response = await turtleFetch(readyUrl, 'GET', {
        retries: 0,
        timeout: 2_000,
      });
      ServeSimReadyResponseSchema.parse(await response.json());
      return;
    } catch (error) {
      lastError = error;
    }
    await sleepAsync(1_000);
  }
  throw new SystemError(
    `Timed out waiting for serve-sim readiness at ${readyUrl}${
      lastError instanceof Error ? `: ${lastError.message}` : ''
    }. Last output:\n${serveSim.getOutput() || '<empty>'}`
  );
}

export type ServeSimPreviewHandle = {
  previewUrl: string;
  stopAsync: () => Promise<void>;
};

export async function startServeSimWithTunnelAsync(
  ctx: CustomBuildContext,
  {
    baseDomain,
    env,
    logger,
    timeoutMs,
  }: {
    baseDomain: string;
    env: BuildStepEnv;
    logger: bunyan;
    timeoutMs: number;
  }
): Promise<ServeSimPreviewHandle> {
  const port = await findAvailablePortAsync();
  logger.info(`Launching ${SERVE_SIM_PACKAGE_SPEC} on ${SERVE_SIM_HOST}:${port}.`);
  const turnArgs = await fetchServeSimTurnArgsAsync(ctx, { env, logger });
  const serveSim = spawnDetached({
    command: 'npx',
    args: createServeSimArgs({ port, turnArgs }),
    env,
  });

  try {
    logger.info('Waiting for serve-sim to become ready.');
    await waitForServeSimReadyAsync({ serveSim, port, timeoutMs });
    const tunnel = await startNgrokTunnelAsync({
      port,
      subdomainPrefix: 'serve-sim',
      baseDomain,
      authtoken: getNgrokAuthtokenOrThrow(env),
      logger,
    });
    return {
      previewUrl: tunnel.url,
      stopAsync: async () => {
        const results = await Promise.allSettled([tunnel.stopAsync(), serveSim.stopAsync()]);
        for (const result of results) {
          if (result.status === 'rejected') {
            logger.warn({ err: result.reason }, 'Could not stop a serve-sim preview resource.');
          }
        }
      },
    };
  } catch (error) {
    await serveSim.stopAsync();
    throw error;
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
  logger.info(`Starting ngrok tunnel ${domain} -> http://localhost:${port}.`);
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
