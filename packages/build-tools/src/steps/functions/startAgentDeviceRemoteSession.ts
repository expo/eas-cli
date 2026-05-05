import { bunyan } from '@expo/logger';
import { BuildFunction, BuildStepInput, BuildStepInputValueTypeName } from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { sleepAsync } from '../../utils/retry';

const AGENT_DEVICE_REPO_URL = 'https://github.com/callstackincubator/agent-device.git';
const SRC_DIR = '/tmp/agent-device-src';
const RUN_DIR = '/tmp/agent-device';
const DAEMON_LOG = path.join(RUN_DIR, 'daemon.log');
const TUNNEL_LOG = path.join(RUN_DIR, 'cloudflared.log');
const DAEMON_JSON_PATH = path.join(os.homedir(), '.agent-device', 'daemon.json');
const XCODE_DEVELOPER_DIR = '/Applications/Xcode.app/Contents/Developer';
const STARTUP_TIMEOUT_MS = 60_000;

export function createStartAgentDeviceRemoteSessionBuildFunction(): BuildFunction {
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
    fn: async ({ logger }, { inputs, env }) => {
      const packageVersion = inputs.package_version.value as string | undefined;
      logger.info(`Starting agent-device remote session (version: ${packageVersion ?? 'latest'}).`);

      logger.info(`Preparing runtime directory at ${RUN_DIR}.`);
      await fs.promises.mkdir(RUN_DIR, { recursive: true });

      logger.info(`Selecting Xcode developer directory: ${XCODE_DEVELOPER_DIR}.`);
      await spawn('sudo', ['xcode-select', '-s', XCODE_DEVELOPER_DIR], { env, logger });

      logger.info('Ensuring cloudflared is installed.');
      await ensureCloudflaredInstalledAsync({ env, logger });

      logger.info('Ensuring bun is installed.');
      await ensureBunInstalledAsync({ env, logger });

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
        command: `cloudflared tunnel --url "http://localhost:${daemonPort}"`,
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

      logger.info('Emitting agent-device credentials for the CLI to pick up:');
      logger.info(`export AGENT_DEVICE_DAEMON_BASE_URL="${tunnelUrl}"`);
      logger.info(`export AGENT_DEVICE_DAEMON_AUTH_TOKEN="${daemonToken}"`);

      logger.info('Remote session is live. Keeping the job alive until the session is stopped.');
      // Keep the turtle job alive so the daemon and tunnel stay reachable
      // until stopDeviceRunSession cancels the run.
      await new Promise<never>(() => {});
    },
  });
}

async function ensureCloudflaredInstalledAsync({
  env,
  logger,
}: {
  env: NodeJS.ProcessEnv;
  logger: bunyan;
}): Promise<void> {
  await ensureBrewPackageInstalledAsync({ name: 'cloudflared', env, logger });
}

async function ensureBunInstalledAsync({
  env,
  logger,
}: {
  env: NodeJS.ProcessEnv;
  logger: bunyan;
}): Promise<void> {
  await ensureBrewPackageInstalledAsync({ name: 'bun', env, logger });
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
