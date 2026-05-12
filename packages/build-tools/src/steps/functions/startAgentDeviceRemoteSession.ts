import { bunyan } from '@expo/logger';
import {
  BuildFunction,
  BuildRuntimePlatform,
  BuildStepInput,
  BuildStepInputValueTypeName,
} from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import { graphql } from 'gql.tada';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { CustomBuildContext } from '../../customBuildContext';
import { sleepAsync } from '../../utils/retry';
import { SystemError } from '@expo/eas-build-job';

const AGENT_DEVICE_REPO_URL = 'https://github.com/callstackincubator/agent-device.git';
const SRC_DIR = '/tmp/agent-device-src';
const RUN_DIR = '/tmp/agent-device';
const DAEMON_LOG = path.join(RUN_DIR, 'daemon.log');
const TUNNEL_LOG = path.join(RUN_DIR, 'cloudflared.log');
const DAEMON_JSON_PATH = path.join(os.homedir(), '.agent-device', 'daemon.json');
const XCODE_DEVELOPER_DIR = '/Applications/Xcode.app/Contents/Developer';
const CLOUDFLARED_LINUX_INSTALL_PATH = '/usr/local/bin/cloudflared';
const STARTUP_TIMEOUT_MS = 60_000;

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
      // Fail fast before any expensive setup if the orchestrator-injected
      // DEVICE_RUN_SESSION_ID env var is missing — without it we cannot
      // report the remote config back to the API server.
      const deviceRunSessionId = env.DEVICE_RUN_SESSION_ID;
      if (!deviceRunSessionId) {
        throw new SystemError(
          'DEVICE_RUN_SESSION_ID is not set. ' +
            'This step must run as part of a device run session created by the API server, ' +
            'which injects DEVICE_RUN_SESSION_ID into the job environment.'
        );
      }

      const packageVersion = inputs.package_version.value as string | undefined;
      const { runtimePlatform } = global;
      logger.info(
        `Starting agent-device remote session (version: ${packageVersion ?? 'latest'}, runtime: ${runtimePlatform}).`
      );

      logger.info(`Preparing runtime directory at ${RUN_DIR}.`);
      await fs.promises.mkdir(RUN_DIR, { recursive: true });

      if (runtimePlatform === BuildRuntimePlatform.DARWIN) {
        logger.info(`Selecting Xcode developer directory: ${XCODE_DEVELOPER_DIR}.`);
        await spawn('sudo', ['xcode-select', '-s', XCODE_DEVELOPER_DIR], { env, logger });
      }

      logger.info('Ensuring cloudflared is installed.');
      const cloudflaredCommand = await ensureCloudflaredInstalledAsync({
        runtimePlatform,
        env,
        logger,
      });

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

      logger.info(`Launching agent-device daemon (log file: ${DAEMON_LOG}).`);
      await spawnDetachedAsync({
        command: 'bun run src/daemon.ts',
        cwd: SRC_DIR,
        logFile: DAEMON_LOG,
        env: { ...env, AGENT_DEVICE_DAEMON_SERVER_MODE: 'http' },
        logger,
      });

      logger.info(`Waiting for daemon credentials at ${DAEMON_JSON_PATH}.`);
      await waitForFileAsync({
        filePath: DAEMON_JSON_PATH,
        timeoutMs: STARTUP_TIMEOUT_MS,
        description: 'agent-device daemon',
      });
      const { port: daemonPort, token: daemonToken } = readDaemonInfo(DAEMON_JSON_PATH);
      logger.info(`Daemon is listening on port ${daemonPort}; loaded auth token.`);

      logger.info(
        `Starting cloudflared tunnel to http://localhost:${daemonPort} (log file: ${TUNNEL_LOG}).`
      );
      await spawnDetachedAsync({
        command: `${cloudflaredCommand} tunnel --url "http://localhost:${daemonPort}"`,
        logFile: TUNNEL_LOG,
        env,
        logger,
      });

      logger.info('Waiting for a public tunnel URL.');
      const tunnelUrl = await waitForMatchInLogAsync({
        logFile: TUNNEL_LOG,
        pattern: /https:\/\/[a-z0-9-]+\.trycloudflare\.com/,
        timeoutMs: STARTUP_TIMEOUT_MS,
        description: 'cloudflared tunnel',
      });
      logger.info(`Tunnel is ready at ${tunnelUrl}.`);

      logger.info(
        `Reporting agent-device remote config to the API server (device run session: ${deviceRunSessionId}).`
      );
      const result = await ctx.graphqlClient
        .mutation(START_DEVICE_RUN_SESSION_MUTATION, {
          deviceRunSessionId,
          remoteConfig: { url: tunnelUrl, token: daemonToken },
        })
        .toPromise();
      if (result.error) {
        throw new SystemError(
          `Failed to start device run session ${deviceRunSessionId}: ${result.error.message}`
        );
      }

      logger.info('Remote session is live. Keeping the job alive until the session is stopped.');
      // Keep the turtle job alive so the daemon and tunnel stay reachable
      // until stopDeviceRunSession cancels the run.
      await new Promise<never>(() => {});
    },
  });
}

async function ensureCloudflaredInstalledAsync({
  runtimePlatform,
  env,
  logger,
}: {
  runtimePlatform: BuildRuntimePlatform;
  env: NodeJS.ProcessEnv;
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
  throw new Error(
    `Unsupported architecture for cloudflared on Linux: "${arch}". Expected "x64" or "arm64".`
  );
}

async function ensureBrewPackageInstalledAsync({
  name,
  env,
  logger,
}: {
  name: string;
  env: NodeJS.ProcessEnv;
  logger: bunyan;
}): Promise<void> {
  await spawn(
    'bash',
    ['-c', `command -v ${name} >/dev/null 2>&1 || HOMEBREW_NO_AUTO_UPDATE=1 brew install ${name}`],
    { env, logger }
  );
}

async function isCommandAvailableAsync({
  command,
  env,
}: {
  command: string;
  env: NodeJS.ProcessEnv;
}): Promise<boolean> {
  try {
    await spawn('bash', ['-c', `command -v ${command}`], { env, ignoreStdio: true });
    return true;
  } catch {
    return false;
  }
}

async function cloneAgentDeviceAsync({
  packageVersion,
  env,
  logger,
}: {
  packageVersion: string | undefined;
  env: NodeJS.ProcessEnv;
  logger: bunyan;
}): Promise<void> {
  const branchArgs = packageVersion ? ['--branch', `v${packageVersion}`] : [];
  await spawn('git', ['clone', '--depth', '1', ...branchArgs, AGENT_DEVICE_REPO_URL, SRC_DIR], {
    env,
    logger,
  });
}

async function spawnDetachedAsync({
  command,
  cwd,
  logFile,
  env,
  logger,
}: {
  command: string;
  cwd?: string;
  logFile: string;
  env: NodeJS.ProcessEnv;
  logger: bunyan;
}): Promise<void> {
  // Launch the process fully detached so this function returns immediately and
  // the grandchild survives the step. Stdio goes to a log file so the daemon
  // output can be polled, and we unref so Node doesn't wait on it.
  const fd = fs.openSync(logFile, 'a');
  try {
    const child = childProcess.spawn('bash', ['-c', command], {
      cwd,
      env,
      detached: true,
      stdio: ['ignore', fd, fd],
    });
    if (!child.pid) {
      throw new Error(`Failed to spawn detached process: ${command}`);
    }
    child.unref();
    logger.info(`Started detached process (pid ${child.pid}).`);
  } finally {
    fs.closeSync(fd);
  }
}

async function waitForMatchInLogAsync({
  logFile,
  pattern,
  timeoutMs,
  description,
}: {
  logFile: string;
  pattern: RegExp;
  timeoutMs: number;
  description: string;
}): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const content = await readFileOrEmptyAsync(logFile);
    const match = pattern.exec(content);
    if (match) {
      return match[1] ?? match[0];
    }
    await sleepAsync(1_000);
  }
  const tail = await readFileOrEmptyAsync(logFile);
  throw new Error(
    `Timed out waiting for ${description} to start. Last log contents:\n${tail || '<empty>'}`
  );
}

async function waitForFileAsync({
  filePath,
  timeoutMs,
  description,
}: {
  filePath: string;
  timeoutMs: number;
  description: string;
}): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fs.promises.access(filePath);
      return;
    } catch {
      // not yet; keep polling
    }
    await sleepAsync(1_000);
  }
  throw new Error(`Timed out waiting for ${description} to write ${filePath}.`);
}

async function readFileOrEmptyAsync(filePath: string): Promise<string> {
  try {
    return await fs.promises.readFile(filePath, 'utf8');
  } catch {
    return '';
  }
}

function readDaemonInfo(filePath: string): { port: number; token: string } {
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw) as unknown;
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    typeof (parsed as { httpPort: unknown }).httpPort !== 'number' ||
    typeof (parsed as { token: unknown }).token !== 'string'
  ) {
    throw new Error(`Expected ${filePath} to contain { "httpPort": <number>, "token": "..." }.`);
  }
  const { httpPort, token } = parsed as { httpPort: number; token: string };
  return { port: httpPort, token };
}
