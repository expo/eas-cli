import { SystemError } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import { BuildStepEnv } from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import * as ngrok from '@ngrok/ngrok';
import { graphql } from 'gql.tada';
import nullthrows from 'nullthrows';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import fetch, { Headers } from 'node-fetch';

import { CustomBuildContext } from '../../customBuildContext';
import { Sentry } from '../../sentry';
import { sleepAsync } from '../../utils/retry';
import { turtleFetch } from '../../utils/turtleFetch';

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

const CREATE_DEVICE_RUN_SESSION_ARTIFACT_UPLOAD_SESSION_MUTATION = graphql(`
  mutation CreateDeviceRunSessionArtifactUploadSession(
    $deviceRunSessionId: ID!
    $input: CreateDeviceRunSessionArtifactUploadSessionInput!
  ) {
    deviceRunSession {
      createArtifactUploadSession(deviceRunSessionId: $deviceRunSessionId, input: $input) {
        uploadSession {
          url
          headers
        }
      }
    }
  }
`);

const ARGENT_FLAGS_FILE = path.join(os.homedir(), '.argent', 'flags.json');
const ARGENT_ARTIFACTS_LIST_ENDPOINT_FLAG = 'artifacts-list-endpoint';
const ARGENT_ARTIFACT_UPLOAD_POLL_INTERVAL_MS = 5_000;

const ArgentArtifactSchema = z.object({
  id: z.string(),
  filename: z.string(),
  mimeType: z.string(),
  size: z.number(),
  isDirectory: z.boolean().optional(),
});
const ArgentArtifactsListResponseSchema = z.object({
  artifacts: z.array(ArgentArtifactSchema),
});
const ArtifactUploadSessionSchema = z.object({
  url: z.string(),
  headers: z.record(z.string(), z.string()),
});

type ArgentArtifact = z.infer<typeof ArgentArtifactSchema>;

type ArtifactUploadSession = {
  url: string;
  headers: Record<string, string>;
};

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

export async function enableArgentArtifactsListEndpointAsync(): Promise<void> {
  let flags: Record<string, boolean> = {};
  try {
    const raw = await fs.promises.readFile(ARGENT_FLAGS_FILE, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      'flags' in parsed &&
      parsed.flags &&
      typeof parsed.flags === 'object' &&
      !Array.isArray(parsed.flags)
    ) {
      flags = Object.fromEntries(
        Object.entries(parsed.flags).filter((entry): entry is [string, boolean] => {
          return typeof entry[1] === 'boolean';
        })
      );
    }
  } catch (err) {
    if (!(err instanceof Error && 'code' in err && err.code === 'ENOENT')) {
      throw err;
    }
  }

  flags[ARGENT_ARTIFACTS_LIST_ENDPOINT_FLAG] = true;
  await fs.promises.mkdir(path.dirname(ARGENT_FLAGS_FILE), { recursive: true });
  await fs.promises.writeFile(ARGENT_FLAGS_FILE, `${JSON.stringify({ flags }, null, 2)}\n`, 'utf8');
}

const TurnIceServersSchema = z.array(
  z.object({
    urls: z.array(z.string()),
    username: z.string().optional(),
    credential: z.string().optional(),
  })
);

export type TurnIceServers = z.infer<typeof TurnIceServersSchema>;

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

export function startArgentArtifactUploadPollingAsync({
  ctx,
  deviceRunSessionId,
  toolsUrl,
  toolsAuthToken,
  logger,
}: {
  ctx: CustomBuildContext;
  deviceRunSessionId: string;
  toolsUrl: string;
  toolsAuthToken?: string;
  logger: bunyan;
}): void {
  const uploadedArtifactIds = new Set<string>();
  const uploadingArtifactIds = new Set<string>();

  void pollArgentArtifactsForUploadAsync({
    ctx,
    deviceRunSessionId,
    toolsUrl,
    toolsAuthToken,
    uploadedArtifactIds,
    uploadingArtifactIds,
    logger,
  });
}

export async function pollArgentArtifactsForUploadAsync({
  ctx,
  deviceRunSessionId,
  toolsUrl,
  toolsAuthToken,
  uploadedArtifactIds,
  uploadingArtifactIds,
  logger,
}: {
  ctx: CustomBuildContext;
  deviceRunSessionId: string;
  toolsUrl: string;
  toolsAuthToken?: string;
  uploadedArtifactIds: Set<string>;
  uploadingArtifactIds: Set<string>;
  logger: bunyan;
}): Promise<never> {
  logger.info('Polling Argent tool-server for artifacts every 5 seconds.');

  for (;;) {
    try {
      const artifacts = await listArgentArtifactsAsync({ toolsUrl, toolsAuthToken });
      await Promise.all(
        artifacts
          .filter(artifact => !uploadedArtifactIds.has(artifact.id))
          .filter(artifact => !uploadingArtifactIds.has(artifact.id))
          .map(async artifact => {
            uploadingArtifactIds.add(artifact.id);
            try {
              await uploadArgentArtifactAsync({
                ctx,
                deviceRunSessionId,
                toolsUrl,
                toolsAuthToken,
                artifact,
                logger,
              });
              uploadedArtifactIds.add(artifact.id);
            } finally {
              uploadingArtifactIds.delete(artifact.id);
            }
          })
      );
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      Sentry.capture('Could not upload Argent remote session artifacts', error, {
        level: 'warning',
      });
      logger.warn({ err: error }, 'Could not upload Argent remote session artifacts.');
    }
    await sleepAsync(ARGENT_ARTIFACT_UPLOAD_POLL_INTERVAL_MS);
  }
}

export async function listArgentArtifactsAsync({
  toolsUrl,
  toolsAuthToken,
}: {
  toolsUrl: string;
  toolsAuthToken?: string;
}): Promise<ArgentArtifact[]> {
  const response = await fetch(new URL('/artifacts', toolsUrl).toString(), {
    headers: getArgentToolServerAuthHeaders(toolsAuthToken),
  });
  if (!response.ok) {
    throw new Error(`Failed to list Argent artifacts: ${response.status} ${response.statusText}`);
  }
  const result = ArgentArtifactsListResponseSchema.safeParse(await response.json());
  if (!result.success) {
    throw new Error(`Invalid Argent artifacts response: ${result.error.message}`);
  }
  return result.data.artifacts;
}

export async function uploadArgentArtifactAsync({
  ctx,
  deviceRunSessionId,
  toolsUrl,
  toolsAuthToken,
  artifact,
  logger,
}: {
  ctx: CustomBuildContext;
  deviceRunSessionId: string;
  toolsUrl: string;
  toolsAuthToken?: string;
  artifact: ArgentArtifact;
  logger: bunyan;
}): Promise<void> {
  const filename = getArgentArtifactUploadFilename(artifact);
  logger.info(`Uploading Argent artifact ${filename} (${artifact.size} bytes).`);
  const stream = await createArgentArtifactDownloadStreamAsync({
    artifact,
    toolsUrl,
    toolsAuthToken,
  });
  const uploadSession = await createDeviceRunSessionArtifactUploadSessionAsync({
    ctx,
    deviceRunSessionId,
    artifactId: artifact.id,
    filename,
    size: artifact.size,
  });
  await uploadArtifactToSignedUrlAsync({
    uploadSession,
    stream,
  });
}

async function createArgentArtifactDownloadStreamAsync({
  artifact,
  toolsUrl,
  toolsAuthToken,
}: {
  artifact: ArgentArtifact;
  toolsUrl: string;
  toolsAuthToken?: string;
}): Promise<NodeJS.ReadableStream> {
  const response = await fetch(new URL(`/artifacts/${artifact.id}`, toolsUrl).toString(), {
    headers: getArgentToolServerAuthHeaders(toolsAuthToken),
  });
  if (!response.ok) {
    throw new Error(
      `Failed to download Argent artifact ${artifact.id}: ${response.status} ${response.statusText}`
    );
  }
  if (!response.body) {
    throw new Error(`Argent artifact ${artifact.id} response did not include a readable body.`);
  }
  return response.body;
}

function getArgentArtifactUploadFilename(artifact: ArgentArtifact): string {
  return artifact.isDirectory ? `${artifact.filename}.tar.gz` : artifact.filename;
}

async function createDeviceRunSessionArtifactUploadSessionAsync({
  ctx,
  deviceRunSessionId,
  artifactId,
  filename,
  size,
}: {
  ctx: CustomBuildContext;
  deviceRunSessionId: string;
  artifactId: string;
  filename: string;
  size: number;
}): Promise<ArtifactUploadSession> {
  const result = await ctx.graphqlClient
    .mutation(CREATE_DEVICE_RUN_SESSION_ARTIFACT_UPLOAD_SESSION_MUTATION, {
      deviceRunSessionId,
      input: {
        name: `Argent artifact ${filename} (${artifactId})`,
        filename,
        size,
      },
    })
    .toPromise();
  if (result.error) {
    throw new SystemError(
      `Failed to create upload session for Argent artifact ${artifactId}: ${result.error.message}`
    );
  }
  const uploadSession =
    result.data?.deviceRunSession.createArtifactUploadSession.uploadSession ?? null;
  if (!uploadSession) {
    throw new SystemError(`Upload session for Argent artifact ${artifactId} was not returned.`);
  }
  const parsedUploadSession = ArtifactUploadSessionSchema.safeParse(uploadSession);
  if (!parsedUploadSession.success) {
    throw new SystemError(
      `Upload session for Argent artifact ${artifactId} was invalid: ${parsedUploadSession.error.message}`
    );
  }
  return parsedUploadSession.data;
}

async function uploadArtifactToSignedUrlAsync({
  uploadSession,
  stream,
}: {
  uploadSession: ArtifactUploadSession;
  stream: NodeJS.ReadableStream;
}): Promise<void> {
  const response = await fetch(uploadSession.url, {
    method: 'PUT',
    headers: new Headers(uploadSession.headers),
    body: stream,
  });
  if (!response.ok) {
    throw new Error(`Failed to upload Argent artifact: ${response.status} ${response.statusText}`);
  }
}

function getArgentToolServerAuthHeaders(
  toolsAuthToken: string | undefined
): Record<string, string> {
  return toolsAuthToken ? { Authorization: `Bearer ${toolsAuthToken}` } : {};
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
): Promise<{ previewUrl: string; streamUrl: string }> {
  logger.info('Launching serve-sim with tunnel.');
  const turnArgs = await fetchServeSimTurnArgsAsync(ctx, { env, logger });
  const serveSim = spawnDetached({
    command: 'npx',
    args: [
      'serve-sim-szdziedzic@latest',
      '--tunnel',
      '--tunnel-provider',
      'ngrok',
      '--tunnel-domain',
      baseDomain,
      '--stream-max-dimension',
      '1280',
      '--stream-quality',
      '0.55',
      '--codec',
      'webrtc',
      ...turnArgs,
    ],
    env,
  });

  logger.info('Waiting for serve-sim to report tunnel and stream URLs.');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const output = serveSim.getOutput();
    const previewUrl = matchLabeledUrl({ output, label: 'Tunnel', baseDomain });
    const streamUrl = matchLabeledUrl({ output, label: 'Stream', baseDomain });
    if (previewUrl && streamUrl) {
      return { previewUrl, streamUrl };
    }
    await sleepAsync(1_000);
  }
  throw new SystemError(
    `Timed out waiting for serve-sim to report Tunnel and Stream URLs. Last output:\n${serveSim.getOutput() || '<empty>'}`
  );
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
