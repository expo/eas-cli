import { SystemError } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import { BuildRuntimePlatform, BuildStepEnv } from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import { graphql } from 'gql.tada';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { CustomBuildContext } from '../../customBuildContext';
import { sleepAsync } from '../../utils/retry';

const NGROK_LINUX_INSTALL_DIR = '/usr/local/bin';
const NGROK_LINUX_INSTALL_PATH = `${NGROK_LINUX_INSTALL_DIR}/ngrok`;

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

export async function ensureNgrokInstalledAsync({
  runtimePlatform,
  env,
  logger,
}: {
  runtimePlatform: BuildRuntimePlatform;
  env: BuildStepEnv;
  logger: bunyan;
}): Promise<string> {
  if (await isCommandAvailableAsync({ command: 'ngrok', env })) {
    return 'ngrok';
  }
  if (runtimePlatform === BuildRuntimePlatform.DARWIN) {
    await spawn('bash', ['-c', 'HOMEBREW_NO_AUTO_UPDATE=1 brew install --cask ngrok'], {
      env,
      logger,
    });
    return 'ngrok';
  }
  const arch = linuxArchForNodeArch(os.arch());
  const downloadUrl = `https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-linux-${arch}.tgz`;
  logger.info(`Downloading ngrok from ${downloadUrl} to ${NGROK_LINUX_INSTALL_PATH}.`);
  await spawn(
    'bash',
    ['-c', `curl -fsSL "${downloadUrl}" | sudo tar -xzf - -C "${NGROK_LINUX_INSTALL_DIR}" ngrok`],
    { env, logger }
  );
  await spawn('sudo', ['chmod', '+x', NGROK_LINUX_INSTALL_PATH], { env, logger });
  // Return the absolute install path so the tunnel command works even when
  // /usr/local/bin is not on the step's PATH.
  return NGROK_LINUX_INSTALL_PATH;
}

function linuxArchForNodeArch(arch: string): 'amd64' | 'arm64' {
  if (arch === 'x64') {
    return 'amd64';
  }
  if (arch === 'arm64') {
    return 'arm64';
  }
  throw new SystemError(
    `Unsupported architecture for ngrok on Linux: "${arch}". Expected "x64" or "arm64".`
  );
}

export async function startNgrokTunnelAsync({
  ngrokCommand,
  port,
  subdomainPrefix,
  baseDomain,
  env,
  logger,
  timeoutMs,
}: {
  ngrokCommand: string;
  port: number;
  subdomainPrefix: string;
  baseDomain: string;
  env: BuildStepEnv;
  logger: bunyan;
  timeoutMs: number;
}): Promise<string> {
  const url = `https://${subdomainPrefix}-${randomBytes(8).toString('hex')}.${baseDomain}`;

  // ngrok serves its inspection web UI on 127.0.0.1:4040 and offers no CLI flag
  // to move it, but serve-sim runs a second ngrok agent on the same host — so
  // two agents would fight over that port. We read the tunnel URL from the
  // agent's stdout logs rather than the web UI, so disable it via config.
  const configDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ngrok-'));
  const configPath = path.join(configDir, 'ngrok.yml');
  await fs.promises.writeFile(configPath, 'version: "3"\nagent:\n  web_addr: false\n');

  logger.info(`Starting ngrok tunnel ${url} -> http://localhost:${port}.`);
  const ngrok = spawnDetached({
    command: ngrokCommand,
    args: [
      'http',
      String(port),
      '--url',
      url,
      '--log',
      'stdout',
      '--log-format',
      'logfmt',
      '--config',
      configPath,
    ],
    env,
  });

  // The agent echoes the endpoint URL back once the tunnel is live; wait for it
  // so we never report a URL the client cannot reach yet.
  await waitForMatchInOutputAsync({
    process: ngrok,
    pattern: new RegExp(escapeRegExp(url)),
    timeoutMs,
    description: `ngrok tunnel ${url}`,
  });
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

export async function waitForMatchInOutputAsync({
  process,
  pattern,
  timeoutMs,
  description,
}: {
  process: DetachedProcessHandle;
  pattern: RegExp;
  timeoutMs: number;
  description: string;
}): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const match = pattern.exec(process.getOutput());
    if (match) {
      return match[1] ?? match[0];
    }
    await sleepAsync(1_000);
  }
  throw new SystemError(
    `Timed out waiting for ${description} to start. Last output:\n${process.getOutput() || '<empty>'}`
  );
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
