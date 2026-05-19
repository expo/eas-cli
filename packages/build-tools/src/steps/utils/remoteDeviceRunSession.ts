import { SystemError } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import { BuildRuntimePlatform, BuildStepEnv } from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import { graphql } from 'gql.tada';
import fs from 'node:fs';
import os from 'node:os';

import { CustomBuildContext } from '../../customBuildContext';
import { sleepAsync } from '../../utils/retry';

const TRYCLOUDFLARE_URL_PATTERN = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;
const CLOUDFLARED_LINUX_INSTALL_PATH = '/usr/local/bin/cloudflared';

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

export async function ensureBrewPackageInstalledAsync({
  name,
  env,
  logger,
}: {
  name: string;
  env: BuildStepEnv;
  logger: bunyan;
}): Promise<void> {
  await spawn(
    'bash',
    ['-c', `command -v ${name} >/dev/null 2>&1 || HOMEBREW_NO_AUTO_UPDATE=1 brew install ${name}`],
    { env, logger }
  );
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
  env,
  logger,
  timeoutMs,
}: {
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
      '--tunnel-protocol',
      'quic',
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
    const previewUrl = matchLabeledUrl(output, 'Tunnel');
    const streamUrl = matchLabeledUrl(output, 'Stream');
    if (previewUrl && streamUrl) {
      return { previewUrl, streamUrl };
    }
    await sleepAsync(1_000);
  }
  throw new SystemError(
    `Timed out waiting for serve-sim to report Tunnel and Stream URLs. Last output:\n${serveSim.getOutput() || '<empty>'}`
  );
}

function matchLabeledUrl(content: string, label: string): string | null {
  const labelPattern = new RegExp(`${label}:\\s*(${TRYCLOUDFLARE_URL_PATTERN.source})`);
  const match = labelPattern.exec(content);
  return match ? match[1] : null;
}

export async function ensureCloudflaredInstalledAsync({
  runtimePlatform,
  env,
  logger,
}: {
  runtimePlatform: BuildRuntimePlatform;
  env: BuildStepEnv;
  logger: bunyan;
}): Promise<string> {
  if (runtimePlatform === BuildRuntimePlatform.DARWIN) {
    await ensureBrewPackageInstalledAsync({ name: 'cloudflared', env, logger });
    return 'cloudflared';
  }
  if (await isCommandAvailableAsync({ command: 'cloudflared', env })) {
    return 'cloudflared';
  }
  const cloudflaredArch = cloudflaredLinuxArchForNodeArch(os.arch());
  const downloadUrl = `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${cloudflaredArch}`;
  logger.info(`Downloading cloudflared from ${downloadUrl} to ${CLOUDFLARED_LINUX_INSTALL_PATH}.`);
  await spawn('sudo', ['curl', '-fsSL', '-o', CLOUDFLARED_LINUX_INSTALL_PATH, downloadUrl], {
    env,
    logger,
  });
  await spawn('sudo', ['chmod', '+x', CLOUDFLARED_LINUX_INSTALL_PATH], { env, logger });
  // Return the absolute install path so the tunnel command works even when
  // /usr/local/bin is not on the step's PATH.
  return CLOUDFLARED_LINUX_INSTALL_PATH;
}

function cloudflaredLinuxArchForNodeArch(arch: string): 'amd64' | 'arm64' {
  if (arch === 'x64') {
    return 'amd64';
  }
  if (arch === 'arm64') {
    return 'arm64';
  }
  throw new SystemError(
    `Unsupported architecture for cloudflared on Linux: "${arch}". Expected "x64" or "arm64".`
  );
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
