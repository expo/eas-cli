import { SystemError } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import { BuildStepEnv } from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import { graphql } from 'gql.tada';

import { CustomBuildContext } from '../../customBuildContext';
import { sleepAsync } from '../../utils/retry';

const TRYCLOUDFLARE_URL_PATTERN = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;

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
    args: ['serve-sim-szdziedzic@latest', '--tunnel'],
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
