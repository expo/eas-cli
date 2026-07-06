import { SystemError } from '@expo/eas-build-job';
import { type bunyan } from '@expo/logger';
import {
  BuildFunction,
  BuildRuntimePlatform,
  type BuildStepEnv,
  BuildStepInput,
  BuildStepInputValueTypeName,
} from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { type CustomBuildContext } from '../../customBuildContext';
import { Sentry } from '../../sentry';
import { pollAgentDeviceArtifactsForUploadAsync } from '../utils/agentDeviceArtifacts';
import {
  type DetachedProcessHandle,
  getDeviceRunSessionIdOrThrow,
  getNgrokAuthtokenOrThrow,
  getNgrokTunnelDomainOrThrow,
  selectXcodeDeveloperDirectoryAsync,
  spawnDetached,
  startNgrokTunnelAsync,
  startServeSimWithTunnelAsync,
  uploadRemoteSessionConfigAsync,
  waitForFileAsync,
} from '../utils/remoteDeviceRunSession';

const AGENT_DEVICE_PACKAGE_NAME = 'agent-device';
const AGENT_DEVICE_REPO_URL = 'https://github.com/callstack/agent-device.git';
const SRC_DIR = '/tmp/agent-device-src';
const DAEMON_JSON_PATH = path.join(os.homedir(), '.agent-device', 'daemon.json');
const STARTUP_TIMEOUT_MS = 60_000;
const AGENT_DEVICE_DAEMON_ENV = {
  AGENT_DEVICE_DAEMON_SERVER_MODE: 'http',
  AGENT_DEVICE_RETAIN_ARTIFACTS: '1',
};

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
        await selectXcodeDeveloperDirectoryAsync({ env, logger });
      }

      logger.info('Launching agent-device daemon.');
      const daemonProcess = await startAgentDeviceDaemonAsync({ packageVersion, env, logger });

      logger.info(`Waiting for daemon credentials at ${DAEMON_JSON_PATH}.`);
      const { port: daemonPort, token: daemonToken } = await waitForDaemonInfoAsync({
        daemonProcess,
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
      void pollAgentDeviceArtifactsForUploadAsync(ctx, {
        deviceRunSessionId,
        daemonUrl: `http://127.0.0.1:${daemonPort}`,
        daemonToken,
        logger,
      });

      logger.info('Remote session is live. Keeping the job alive until the session is stopped.');
      // Keep the turtle job alive so the daemon and tunnel stay reachable
      // until stopDeviceRunSession cancels the run.
      await new Promise<never>(() => {});
    },
  });
}

async function startAgentDeviceDaemonAsync({
  packageVersion,
  env,
  logger,
}: {
  packageVersion: string | undefined;
  env: BuildStepEnv;
  logger: bunyan;
}): Promise<DetachedProcessHandle> {
  const packageSpec = createAgentDevicePackageSpec(packageVersion);
  try {
    logger.info(`Installing ${packageSpec} globally with Bun.`);
    await spawn('bun', ['add', '--global', packageSpec], {
      env,
      logger,
    });

    const daemonPath = getGlobalAgentDeviceDaemonPath(env);
    if (!fs.existsSync(daemonPath)) {
      throw new SystemError(`Expected agent-device daemon entry at ${daemonPath}.`);
    }

    logger.info(`Launching daemon from ${daemonPath}.`);
    return spawnDetached({
      command: 'node',
      args: [daemonPath],
      env: { ...env, ...AGENT_DEVICE_DAEMON_ENV },
    });
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    const bunVersion = await getBunVersionForDiagnosticsAsync(env);
    Sentry.capture(
      'Failed to start agent-device daemon from global Bun package; falling back to git clone',
      error,
      {
        level: 'warning',
        tags: {
          phase: 'agent-device-daemon-start',
          fallback: 'git-clone',
        },
        extras: {
          packageSpec,
          packageVersion: packageVersion ?? 'latest',
          bunVersion,
          bunInstallConfigured: Boolean(env.BUN_INSTALL?.trim()),
        },
      }
    );
    logger.warn(
      `Failed to start daemon from global ${packageSpec}; falling back to git clone: ${error.message}`
    );
    return await startAgentDeviceDaemonFromGitAsync({ packageVersion, env, logger });
  }
}

async function startAgentDeviceDaemonFromGitAsync({
  packageVersion,
  env,
  logger,
}: {
  packageVersion: string | undefined;
  env: BuildStepEnv;
  logger: bunyan;
}): Promise<DetachedProcessHandle> {
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

  logger.info('Launching daemon from cloned agent-device source.');
  return spawnDetached({
    command: 'bun',
    args: ['run', 'src/daemon.ts'],
    cwd: SRC_DIR,
    env: { ...env, ...AGENT_DEVICE_DAEMON_ENV },
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

async function waitForDaemonInfoAsync({
  daemonProcess,
}: {
  daemonProcess: DetachedProcessHandle;
}): Promise<{ port: number; token: string }> {
  try {
    return await waitForFileAsync({
      filePath: DAEMON_JSON_PATH,
      timeoutMs: STARTUP_TIMEOUT_MS,
      description: 'agent-device daemon credentials',
      parse: parseDaemonInfo,
    });
  } catch (err) {
    const output = daemonProcess.getOutput();
    throw new SystemError(
      `${
        err instanceof Error
          ? err.message
          : `Timed out waiting for agent-device daemon credentials.`
      }${output ? `\nagent-device daemon output:\n${output}` : ''}`
    );
  }
}

async function getBunVersionForDiagnosticsAsync(env: BuildStepEnv): Promise<string> {
  try {
    const result = await spawn('bun', ['--version'], { stdio: 'pipe', env, cwd: os.tmpdir() });
    return result.stdout.trim() || 'unknown';
  } catch {
    return 'unknown';
  }
}

function createAgentDevicePackageSpec(packageVersion: string | undefined): string {
  const versionSpec = packageVersion ? packageVersion.replace(/^v(?=\d)/, '') : 'latest';
  return `${AGENT_DEVICE_PACKAGE_NAME}@${versionSpec}`;
}

function getGlobalAgentDeviceDaemonPath(env: BuildStepEnv): string {
  return path.join(
    getBunInstallDirectory(env),
    'install',
    'global',
    'node_modules',
    AGENT_DEVICE_PACKAGE_NAME,
    'dist',
    'src',
    'internal',
    'daemon.js'
  );
}

function getBunInstallDirectory(env: BuildStepEnv): string {
  const bunInstall = env.BUN_INSTALL?.trim();
  return bunInstall ? bunInstall : path.join(os.homedir(), '.bun');
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
