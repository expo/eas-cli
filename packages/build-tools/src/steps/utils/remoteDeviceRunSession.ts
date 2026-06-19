import { SystemError } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import { BuildStepEnv, spawnAsync } from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import * as ngrok from '@ngrok/ngrok';
import { graphql } from 'gql.tada';
import nullthrows from 'nullthrows';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';

import { CustomBuildContext } from '../../customBuildContext';
import { Sentry } from '../../sentry';
import { sleepAsync } from '../../utils/retry';
import { turtleFetch } from '../../utils/turtleFetch';

const XCODE_DEVELOPER_DIR = '/Applications/Xcode.app/Contents/Developer';

const SERVE_SIM_PACKAGE_SPEC = 'serve-sim-sjchmiela@latest';
const SERVE_SIM_MJPEG_FALLBACK_MAX_DIMENSION = '1280';
const SERVE_SIM_MJPEG_FALLBACK_QUALITY = '0.55';
const SERVE_SIM_MJPEG_FALLBACK_FPS = '10';
const SERVE_SIM_H264_BITRATE = '3000000';
const SERVE_SIM_H264_MAX_FPS = '30';

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
  getOutput: () => string;
};

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

  return { getOutput: () => output };
}

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
): Promise<{ previewUrl: string }> {
  logger.info('Launching serve-sim with tunnel.');
  const turnArgs = await fetchServeSimTurnArgsAsync(ctx, { env, logger });
  const serveSim = spawnDetached({
    command: 'npx',
    args: createServeSimTunnelArgs({ baseDomain, turnArgs }),
    env,
  });

  logger.info('Waiting for serve-sim to report tunnel URL.');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const output = serveSim.getOutput();
    const previewUrl = matchLabeledUrl({ output, label: 'Tunnel', baseDomain });
    if (previewUrl) {
      return { previewUrl };
    }
    await sleepAsync(1_000);
  }
  throw new SystemError(
    `Timed out waiting for serve-sim to report Tunnel URL. Last output:\n${serveSim.getOutput() || '<empty>'}`
  );
}

export function createServeSimTunnelArgs({
  baseDomain,
  turnArgs = [],
}: {
  baseDomain: string;
  turnArgs?: string[];
}): string[] {
  return [
    SERVE_SIM_PACKAGE_SPEC,
    '--tunnel',
    '--tunnel-provider',
    'ngrok',
    '--tunnel-domain',
    baseDomain,
    // MJPEG remains the browser fallback when AVCC/H.264 is unavailable.
    '--stream-max-dimension',
    SERVE_SIM_MJPEG_FALLBACK_MAX_DIMENSION,
    '--stream-quality',
    SERVE_SIM_MJPEG_FALLBACK_QUALITY,
    '--stream-fps',
    SERVE_SIM_MJPEG_FALLBACK_FPS,
    // The tunneled helper advertises /stream.avcc, so keep H.264 network usage bounded.
    '--h264-bitrate',
    SERVE_SIM_H264_BITRATE,
    '--h264-max-fps',
    SERVE_SIM_H264_MAX_FPS,
    ...turnArgs,
  ];
}

function matchLabeledUrl({
  output,
  label,
  baseDomain,
}: {
  output: string;
  label: string;
  baseDomain: string;
}): string | null {
  const labelPattern = new RegExp(
    `${label}:\\s*(https:\\/\\/[a-z0-9-]+\\.${escapeRegExp(baseDomain)})`
  );
  const match = labelPattern.exec(output);
  return match ? match[1] : null;
}

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
}): Promise<string> {
  const domain = `${subdomainPrefix}-${randomBytes(8).toString('hex')}.${baseDomain}`;
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
    throw new SystemError(`ngrok tunnel for ${domain} did not return a public URL.`);
  }
  return url;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
