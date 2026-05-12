import { SystemError } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import { BuildStepEnv } from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import { graphql } from 'gql.tada';

import { CustomBuildContext } from '../../customBuildContext';

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
