import { SystemError } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import { BuildStepEnv } from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import * as ngrok from '@ngrok/ngrok';
import { graphql } from 'gql.tada';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';

import { CustomBuildContext } from '../../customBuildContext';
import { sleepAsync } from '../../utils/retry';

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
        'This step must run as part of a device run session created by the API server, ' +
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
        'This step must run as part of a device run session created by the API server, ' +
        'which injects EAS_SIMULATOR_NGROK_TUNNEL_DOMAIN (the base domain for ngrok ' +
        'tunnels, e.g. expo-simulator.ngrok.dev) into the job environment.'
    );
  }
  return baseDomain;
}

export function getNgrokAuthtokenOrThrow(env: BuildStepEnv): string {
  const authtoken = env.NGROK_AUTHTOKEN;
  if (!authtoken) {
    throw new SystemError(
      'NGROK_AUTHTOKEN is not set. ' +
        'This step must run as part of a device run session created by the API server, ' +
        'which injects NGROK_AUTHTOKEN into the job environment.'
    );
  }
  return authtoken;
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

export async function startServeSimWithTunnelAsync({
  baseDomain,
  env,
  logger,
  timeoutMs,
}: {
  baseDomain: string;
  env: BuildStepEnv;
  logger: bunyan;
  timeoutMs: number;
}): Promise<{ previewUrl: string; streamUrl: string }> {
  logger.info('Launching serve-sim with tunnel.');
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
    ],
    env,
  });

  logger.info('Waiting for serve-sim to report tunnel and stream URLs.');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const output = serveSim.getOutput();
    const previewUrl = matchLabeledUrl(output, 'Tunnel', baseDomain);
    const streamUrl = matchLabeledUrl(output, 'Stream', baseDomain);
    if (previewUrl && streamUrl) {
      return { previewUrl, streamUrl };
    }
    await sleepAsync(1_000);
  }
  throw new SystemError(
    `Timed out waiting for serve-sim to report Tunnel and Stream URLs. Last output:\n${serveSim.getOutput() || '<empty>'}`
  );
}

function matchLabeledUrl(content: string, label: string, baseDomain: string): string | null {
  const labelPattern = new RegExp(
    `${label}:\\s*(https:\\/\\/[a-z0-9-]+\\.${escapeRegExp(baseDomain)})`
  );
  const match = labelPattern.exec(content);
  return match ? match[1] : null;
}

// serve-sim shells out to the `ngrok` CLI for `--tunnel-provider ngrok`, so it
// needs the agent on PATH. serve-sim is macOS-only, so Homebrew suffices. Our
// own tunnels use the in-process SDK (startNgrokTunnelAsync) and need no CLI.
export async function ensureNgrokCliInstalledAsync({
  env,
  logger,
}: {
  env: BuildStepEnv;
  logger: bunyan;
}): Promise<void> {
  if (await isCommandAvailableAsync({ command: 'ngrok', env })) {
    return;
  }
  await spawn('bash', ['-c', 'HOMEBREW_NO_AUTO_UPDATE=1 brew install --cask ngrok'], {
    env,
    logger,
  });
}

export async function startNgrokTunnelAsync({
  port,
  subdomainPrefix,
  baseDomain,
  authtoken,
  logger,
}: {
  port: number;
  subdomainPrefix: string;
  baseDomain: string;
  authtoken: string;
  logger: bunyan;
}): Promise<string> {
  const domain = `${subdomainPrefix}-${randomBytes(8).toString('hex')}.${baseDomain}`;
  logger.info(`Starting ngrok tunnel ${domain} -> http://localhost:${port}.`);
  // Run the ngrok agent in-process via the SDK. The SDK keeps the session alive
  // until the process exits (the step blocks forever to hold it open), and it
  // has no local web UI, so it never collides with serve-sim's own ngrok agent.
  const listener = await ngrok.forward({ addr: port, authtoken, domain });
  const url = listener.url();
  if (!url) {
    throw new SystemError(`ngrok tunnel for ${domain} did not return a public URL.`);
  }
  return url;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function isCommandAvailableAsync({
  command,
  env,
}: {
  command: string;
  env: BuildStepEnv;
}): Promise<boolean> {
  try {
    await spawn('bash', ['-c', `command -v ${command}`], { env, ignoreStdio: true });
    return true;
  } catch {
    return false;
  }
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
