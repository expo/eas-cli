import { SystemError } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import {
  BuildFunction,
  BuildRuntimePlatform,
  BuildStepEnv,
  BuildStepInput,
  BuildStepInputValueTypeName,
} from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import os from 'node:os';
import path from 'node:path';

import { CustomBuildContext } from '../../customBuildContext';
import {
  getDeviceRunSessionIdOrThrow,
  getNgrokAuthtokenOrThrow,
  getNgrokTunnelDomainOrThrow,
  spawnDetached,
  startNgrokTunnelAsync,
  startServeSimWithTunnelAsync,
  uploadRemoteSessionConfigAsync,
  waitForFileAsync,
} from '../utils/remoteDeviceRunSession';

const AGENT_DEVICE_REPO_URL = 'https://github.com/callstackincubator/agent-device.git';
const SRC_DIR = '/tmp/agent-device-src';
const DAEMON_JSON_PATH = path.join(os.homedir(), '.agent-device', 'daemon.json');
const XCODE_DEVELOPER_DIR = '/Applications/Xcode.app/Contents/Developer';
const STARTUP_TIMEOUT_MS = 60_000;

export function createStartAgentDeviceRemoteSessionBuildFunction(
  ctx: CustomBuildContext
): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'start_agent_device_remote_session',
    name: 'Start agent device remote session',
    __metricsId: 'eas/start_agent_device_remote_session',
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'package_version',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
    ],
    fn: async ({ logger, global }, { inputs, env }) => {
      // Fail fast before any expensive setup if the injected env
      // vars are missing: DEVICE_RUN_SESSION_ID (to report the remote config
      // back to the API server), EAS_SIMULATOR_NGROK_TUNNEL_DOMAIN (base domain
      // for our ngrok tunnels), and NGROK_AUTHTOKEN (to authenticate them).
      const deviceRunSessionId = getDeviceRunSessionIdOrThrow(env);
      const ngrokTunnelDomain = getNgrokTunnelDomainOrThrow(env);
      const ngrokAuthtoken = getNgrokAuthtokenOrThrow(env);

      const packageVersion = inputs.package_version.value as string | undefined;
      const { runtimePlatform } = global;
      logger.info(
        `Starting agent-device remote session (version: ${packageVersion ?? 'latest'}, runtime: ${runtimePlatform}).`
      );

      if (runtimePlatform === BuildRuntimePlatform.DARWIN) {
        logger.info(`Selecting Xcode developer directory: ${XCODE_DEVELOPER_DIR}.`);
        await spawn('sudo', ['xcode-select', '-s', XCODE_DEVELOPER_DIR], { env, logger });
      }

      logger.info(
        packageVersion
          ? `Cloning agent-device @ v${packageVersion} into ${SRC_DIR}.`
          : `Cloning agent-device (latest) into ${SRC_DIR}.`
      );
      await cloneAgentDeviceAsync({ packageVersion, env, logger });

      logger.info('Installing agent-device dependencies.');
      await spawn('bun', ['install', '--production'], {
        cwd: SRC_DIR,
        env,
        logger,
      });

      logger.info('Launching agent-device daemon.');
      spawnDetached({
        command: 'bun',
        args: ['run', 'src/daemon.ts'],
        cwd: SRC_DIR,
        env: { ...env, AGENT_DEVICE_DAEMON_SERVER_MODE: 'http' },
      });

      logger.info(`Waiting for daemon credentials at ${DAEMON_JSON_PATH}.`);
      const { port: daemonPort, token: daemonToken } = await waitForFileAsync({
        filePath: DAEMON_JSON_PATH,
        timeoutMs: STARTUP_TIMEOUT_MS,
        description: 'agent-device daemon credentials',
        parse: parseDaemonInfo,
      });
      logger.info(`Daemon is listening on port ${daemonPort}; loaded auth token.`);

      const agentDeviceRemoteSessionUrl = await startNgrokTunnelAsync({
        port: daemonPort,
        subdomainPrefix: 'agent-device',
        baseDomain: ngrokTunnelDomain,
        authtoken: ngrokAuthtoken,
        logger,
      });
      logger.info(`Tunnel is ready at ${agentDeviceRemoteSessionUrl}.`);

      // serve-sim is iOS-only — only launch it (and report a webPreviewUrl)
      // on Darwin. Android sessions go without a preview URL.
      let webPreviewUrl: string | undefined;
      if (runtimePlatform === BuildRuntimePlatform.DARWIN) {
        const { previewUrl } = await startServeSimWithTunnelAsync(ctx, {
          baseDomain: ngrokTunnelDomain,
          env,
          logger,
          timeoutMs: STARTUP_TIMEOUT_MS,
        });
        webPreviewUrl = previewUrl;
        logger.info(`Web preview URL: ${webPreviewUrl}`);
      }

      await uploadRemoteSessionConfigAsync({
        ctx,
        deviceRunSessionId,
        remoteConfig: {
          agentDeviceRemoteSessionUrl,
          agentDeviceRemoteSessionToken: daemonToken,
          ...(webPreviewUrl ? { webPreviewUrl } : {}),
        },
        logger,
      });

      logger.info('Remote session is live. Keeping the job alive until the session is stopped.');
      // Keep the turtle job alive so the daemon and tunnel stay reachable
      // until stopDeviceRunSession cancels the run.
      await new Promise<never>(() => {});
    },
  });
}

async function cloneAgentDeviceAsync({
  packageVersion,
  env,
  logger,
}: {
  packageVersion: string | undefined;
  env: BuildStepEnv;
  logger: bunyan;
}): Promise<void> {
  const branchArgs = packageVersion ? ['--branch', `v${packageVersion}`] : [];
  await spawn('git', ['clone', '--depth', '1', ...branchArgs, AGENT_DEVICE_REPO_URL, SRC_DIR], {
    env,
    logger,
  });
}

function parseDaemonInfo(raw: string): { port: number; token: string } {
  const parsed = JSON.parse(raw) as unknown;
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    typeof (parsed as { httpPort: unknown }).httpPort !== 'number' ||
    typeof (parsed as { token: unknown }).token !== 'string'
  ) {
    throw new SystemError(
      'Expected daemon credentials to contain { "httpPort": <number>, "token": "..." }.'
    );
  }
  const { httpPort, token } = parsed as { httpPort: number; token: string };
  return { port: httpPort, token };
}
