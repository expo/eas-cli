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
import fs from 'node:fs';
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
import { sleepAsync } from '../../utils/retry';

const AGENT_DEVICE_REPO_URL = 'https://github.com/callstackincubator/agent-device.git';
const SRC_DIR = '/tmp/agent-device-src';
const DAEMON_JSON_PATH = path.join(os.homedir(), '.agent-device', 'daemon.json');
const XCODE_DEVELOPER_DIR = '/Applications/Xcode.app/Contents/Developer';
const STARTUP_TIMEOUT_MS = 60_000;

const IDLE_HOOK_PATH = path.join(os.tmpdir(), 'agent-device-idle-hook.mjs');
const IDLE_STATE_PATH = path.join(os.tmpdir(), 'agent-device-last-activity');
const IDLE_POLL_INTERVAL_MS = 30_000;

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
      BuildStepInput.createProvider({
        id: 'max_idle_minutes',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.NUMBER,
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
      const rawMaxIdleMinutes = inputs.max_idle_minutes.value as number | undefined;
      const maxIdleMinutes =
        typeof rawMaxIdleMinutes === 'number' && rawMaxIdleMinutes > 0
          ? rawMaxIdleMinutes
          : undefined;
      const { runtimePlatform } = global;
      logger.info(
        `Starting agent-device remote session (version: ${packageVersion ?? 'latest'}, runtime: ${runtimePlatform}${
          maxIdleMinutes != null ? `, max idle: ${maxIdleMinutes}m` : ''
        }).`
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

      const idleEnv: Record<string, string> = {};
      if (maxIdleMinutes != null) {
        await writeIdleAuthHookAsync(logger);
        idleEnv.AGENT_DEVICE_HTTP_AUTH_HOOK = IDLE_HOOK_PATH;
      }

      logger.info('Launching agent-device daemon.');
      spawnDetached({
        command: 'bun',
        args: ['run', 'src/daemon.ts'],
        cwd: SRC_DIR,
        env: { ...env, ...idleEnv, AGENT_DEVICE_DAEMON_SERVER_MODE: 'http' },
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
        const { previewUrl } = await startServeSimWithTunnelAsync({
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

      if (maxIdleMinutes != null) {
        logger.info(
          `Remote session is live. Watching for >= ${maxIdleMinutes}m of inactivity; otherwise keeping the job alive until the session is stopped.`
        );
        await waitForIdleTimeoutAsync({ maxIdleMs: maxIdleMinutes * 60_000, logger });
      } else {
        logger.info('Remote session is live. Keeping the job alive until the session is stopped.');
        // Keep the turtle job alive so the daemon and tunnel stay reachable
        // until stopDeviceRunSession cancels the run.
        await new Promise<never>(() => {});
      }
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

async function writeIdleAuthHookAsync(logger: bunyan): Promise<void> {
  // Pre-seed so the first poll has a baseline; otherwise it would compute an
  // unbounded idle window and false-positive the timeout.
  await fs.promises.writeFile(IDLE_STATE_PATH, String(Date.now()), 'utf8');

  // Loaded by agent-device's daemon http-server `loadHttpAuthHook`. Must not
  // throw — a failing hook 401s every request.
  const hookSource = `import { writeFileSync } from 'node:fs';
const STATE_PATH = ${JSON.stringify(IDLE_STATE_PATH)};
export default function recordActivityHook() {
  try {
    writeFileSync(STATE_PATH, String(Date.now()), 'utf8');
  } catch {}
  return true;
}
`;
  await fs.promises.writeFile(IDLE_HOOK_PATH, hookSource, 'utf8');
  logger.info(`Installed idle-activity auth hook at ${IDLE_HOOK_PATH}.`);
}

async function waitForIdleTimeoutAsync({
  maxIdleMs,
  logger,
}: {
  maxIdleMs: number;
  logger: bunyan;
}): Promise<never> {
  while (true) {
    await sleepAsync(IDLE_POLL_INTERVAL_MS);

    let lastActivityAt: number;
    try {
      const raw = await fs.promises.readFile(IDLE_STATE_PATH, 'utf8');
      lastActivityAt = Number(raw);
    } catch {
      // Skip this tick — the hook will re-write the file on the next request.
      continue;
    }
    if (!Number.isFinite(lastActivityAt)) {
      continue;
    }

    const idleMs = Date.now() - lastActivityAt;
    if (idleMs >= maxIdleMs) {
      const idleMinutes = Math.floor(idleMs / 60_000);
      const maxIdleMinutes = Math.floor(maxIdleMs / 60_000);
      logger.error(
        `agent-device remote session was idle for ${idleMinutes} minute(s); the limit is ${maxIdleMinutes} minute(s). Failing the step to release the worker.`
      );
      throw new SystemError(
        `agent-device remote session exceeded the max idle window (${idleMinutes} >= ${maxIdleMinutes} minute(s)). Start a new session and reconnect, or raise the maxIdleMinutes when creating the session.`
      );
    }
  }
}
