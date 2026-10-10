import { SystemError } from '@expo/eas-build-job';
import { type bunyan } from '@expo/logger';
import { BuildRuntimePlatform, type BuildStepEnv } from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { type CustomBuildContext } from '../../customBuildContext';
import { uploadRemoteSessionConfigWithLocalEgressAsync } from '../utils/localEgressSession';
import { type DeviceSessionHost, startDeviceSessionHostAsync } from '../utils/deviceSessionHost';
import { Sentry } from '../../sentry';
import {
  PackageManager,
  resolveConfiguredPackageManager,
  resolvePackageAdd,
  resolvePackageInstall,
} from '../../utils/packageManager';
import { pollAgentDeviceArtifactsForUploadAsync } from '../utils/agentDeviceArtifacts';
import { type parseNetworkCaptureInputs } from '../utils/networkCaptureFields';
import { startAgentDeviceEventCollectionAsync } from '../utils/agentDeviceEvents';
import { type ServeSimApplicationOptions } from '../utils/remoteDeviceRunSession';
import { type StartupTasks } from '../utils/startupTasks';
import {
  type DetachedProcessHandle,
  finishRemoteSessionAsync,
  getDeviceRunSessionIdOrThrow,
  getNgrokAuthtokenOrThrow,
  getNgrokTunnelDomainOrThrow,
  spawnDetached,
  startNgrokTunnelAsync,
  waitForDeviceRunSessionStoppedAsync,
  waitForFileAsync,
} from '../utils/remoteDeviceRunSession';

const AGENT_DEVICE_PACKAGE_NAME = 'agent-device';
const AGENT_DEVICE_REPO_URL = 'https://github.com/callstack/agent-device.git';
const SRC_DIR = '/tmp/agent-device-src';
const AGENT_DEVICE_STATE_DIR = path.join(os.homedir(), '.agent-device');
const DAEMON_JSON_PATH = path.join(AGENT_DEVICE_STATE_DIR, 'daemon.json');
const STARTUP_TIMEOUT_MS = 60_000;
const AGENT_DEVICE_DAEMON_ENV = {
  AGENT_DEVICE_DAEMON_SERVER_MODE: 'http',
  AGENT_DEVICE_RETAIN_ARTIFACTS: '1',
  // The session lifetime is owned by max_idle_time_minutes / max_duration_seconds
  // and the device run session stop, so disable agent-device's own idle timers.
  // Without this the daemon exits after 5 minutes with no open session, and the
  // tunnel is left without a daemon behind it.
  AGENT_DEVICE_DAEMON_IDLE_TIMEOUT_MS: '0',
  AGENT_DEVICE_IOS_RUNNER_IDLE_STOP_MS: '0',
  AGENT_DEVICE_SESSION_IDLE_TIMEOUT_MS: '0',
};

export type AgentDeviceRemoteSessionEnv = {
  deviceRunSessionId: string;
  ngrokTunnelDomain: string;
  ngrokAuthtoken: string;
};

/**
 * Reads the env vars that the API server injects into a device run session job:
 * DEVICE_RUN_SESSION_ID (to report the remote config back to the API server),
 * EAS_SIMULATOR_NGROK_TUNNEL_DOMAIN (base domain for our ngrok tunnels), and
 * NGROK_AUTHTOKEN (to authenticate them).
 */
export function getAgentDeviceRemoteSessionEnvOrThrow(
  env: BuildStepEnv
): AgentDeviceRemoteSessionEnv {
  return {
    deviceRunSessionId: getDeviceRunSessionIdOrThrow(env),
    ngrokTunnelDomain: getNgrokTunnelDomainOrThrow(env),
    ngrokAuthtoken: getNgrokAuthtokenOrThrow(env),
  };
}

/**
 * Starts the agent-device daemon, its tunnel, the session host and the web preview,
 * reports the session as ready, and keeps it alive until it stops.
 *
 * Serve-sim boots while the iOS download runs. After device preparation verifies
 * any egress guard, its control API installs and launches the app.
 * Startup failures abort the other tasks; teardown drains them before stopping acquired resources.
 */
export async function runAgentDeviceRemoteSessionAsync(
  ctx: CustomBuildContext,
  {
    env,
    logger,
    signal,
    runtimePlatform,
    sessionEnv: { deviceRunSessionId, ngrokTunnelDomain, ngrokAuthtoken },
    packageVersion,
    maxIdleTimeMinutes,
    maxDurationSeconds,
    capture,
    tasks,
    device,
  }: {
    env: BuildStepEnv;
    logger: bunyan;
    signal?: AbortSignal;
    runtimePlatform: BuildRuntimePlatform;
    sessionEnv: AgentDeviceRemoteSessionEnv;
    packageVersion: string | undefined;
    maxIdleTimeMinutes: number | undefined;
    maxDurationSeconds: number | undefined;
    capture: ReturnType<typeof parseNetworkCaptureInputs>;
    tasks: StartupTasks;
    device:
      | {
          booted: Promise<unknown>;
          ready: Promise<unknown>;
        }
      | {
          iosSimulatorUdid: string;
          bootEnv?: Record<string, string>;
          application?: Promise<ServeSimApplicationOptions | void>;
        };
  }
): Promise<void> {
  signal?.throwIfAborted();
  tasks.signal.throwIfAborted();

  logger.info(
    `Starting agent-device remote session (version: ${packageVersion ?? 'latest'}, runtime: ${runtimePlatform}).`
  );

  let daemonProcess: DetachedProcessHandle | undefined;
  let agentDeviceTunnel: Awaited<ReturnType<typeof startNgrokTunnelAsync>> | undefined;
  let sessionHost: DeviceSessionHost | undefined;
  let eventCollection: Awaited<ReturnType<typeof startAgentDeviceEventCollectionAsync>> | undefined;
  let sessionFailed = false;
  const daemonSecrets = [ngrokAuthtoken];
  const hostBootedDevice = 'iosSimulatorUdid' in device ? device : undefined;
  const externallyBootedDevice = 'booted' in device ? device : undefined;

  // Each task stores what it started, so the teardown below can stop it even when
  // another task failed first.
  const agentDeviceStartup = tasks.run('agent-device daemon', async taskLogger => {
    taskLogger.info('Launching agent-device daemon.');
    daemonProcess = await startAgentDeviceDaemonAsync({
      packageVersion,
      env,
      logger: taskLogger,
      signal: tasks.signal,
      secrets: daemonSecrets,
    });

    taskLogger.info(`Waiting for daemon credentials at ${DAEMON_JSON_PATH}.`);
    // The daemon is stored above, so the teardown stops it. The wait itself is bounded
    // (STARTUP_TIMEOUT_MS) and only reads a file, so it may finish in the background.
    const daemonInfo = await tasks.untilAborted(waitForDaemonInfoAsync({ daemonProcess }));
    daemonSecrets.push(daemonInfo.token);
    taskLogger.info(`Daemon is listening on port ${daemonInfo.port}; loaded auth token.`);

    tasks.signal.throwIfAborted();
    agentDeviceTunnel = await startNgrokTunnelAsync({
      port: daemonInfo.port,
      subdomainPrefix: 'agent-device',
      baseDomain: ngrokTunnelDomain,
      authtoken: ngrokAuthtoken,
      healthCheck: { path: '/health' },
      logger: taskLogger,
    });
    tasks.signal.throwIfAborted();
    taskLogger.info(`Tunnel is ready at ${agentDeviceTunnel.url}.`);
    return { ...daemonInfo, remoteSessionUrl: agentDeviceTunnel.url };
  });
  const sessionHostStartup = tasks.run('session host', async taskLogger => {
    if (externallyBootedDevice) {
      await tasks.untilAborted(externallyBootedDevice.booted);
    }
    tasks.signal.throwIfAborted();
    sessionHost = await startDeviceSessionHostAsync(ctx, {
      separateLogPhase: true,
      runtimePlatform,
      env,
      logger: taskLogger,
      timeoutMs: STARTUP_TIMEOUT_MS,
      signal: tasks.signal,
      onStartupError: tasks.abort,
      networkCapture: capture.networkCapture,
      networkCaptureFields: capture.networkCaptureFields,
      iosSimulatorUdid: hostBootedDevice?.iosSimulatorUdid,
      bootEnv: hostBootedDevice?.bootEnv,
      application: hostBootedDevice?.application,
    });
    tasks.signal.throwIfAborted();
    const webPreview = await sessionHost.openPreviewAsync({ baseDomain: ngrokTunnelDomain });
    tasks.signal.throwIfAborted();
    taskLogger.info(
      `Web preview URL: ${webPreview.previewPageUrl} (server: ${webPreview.apiUrl}).`
    );
    return webPreview;
  });
  const deviceReady = externallyBootedDevice?.ready;

  try {
    const [
      { port: daemonPort, token: daemonToken, remoteSessionUrl: agentDeviceRemoteSessionUrl },
      webPreview,
    ] = await Promise.all([agentDeviceStartup, sessionHostStartup, deviceReady]).catch(
      (err: unknown) => {
        // Also aborts for a `device.ready` that does not come from `tasks.run`.
        tasks.abort(err);
        throw tasks.signal.reason;
      }
    );
    tasks.signal.throwIfAborted();
    logger.info(tasks.summary());

    await uploadRemoteSessionConfigWithLocalEgressAsync({
      env,
      signal,
      ctx,
      deviceRunSessionId,
      remoteConfig: {
        agentDeviceRemoteSessionUrl,
        agentDeviceRemoteSessionToken: daemonToken,
        webPreviewUrl: webPreview.previewPageUrl,
        previewApiUrl: webPreview.apiUrl,
        ...(webPreview.previewToken ? { webPreviewToken: webPreview.previewToken } : {}),
      },
      logger,
    });
    tasks.signal.throwIfAborted();
    void pollAgentDeviceArtifactsForUploadAsync(ctx, {
      deviceRunSessionId,
      daemonUrl: `http://127.0.0.1:${daemonPort}`,
      daemonToken,
      logger,
    });

    eventCollection = await startAgentDeviceEventCollectionAsync({
      ctx,
      deviceRunSessionId,
      stateDir: AGENT_DEVICE_STATE_DIR,
      logger,
    });

    await waitForDeviceRunSessionStoppedAsync({
      ctx,
      deviceRunSessionId,
      logger,
      maxDurationSeconds,
      signal,
      idleTimeout:
        maxIdleTimeMinutes !== undefined && maxIdleTimeMinutes > 0
          ? {
              maxIdleTimeMinutes,
              getLastEventObservedAt: eventCollection.getLastEventObservedAt,
            }
          : undefined,
    });
  } catch (error) {
    sessionFailed = true;
    throw error;
  } finally {
    // Promise.all rejects on the first failure while other tasks can still be starting.
    // They stop at their next abort check. Wait for all of them, so the teardown sees
    // everything that was started.
    await Promise.allSettled([agentDeviceStartup, sessionHostStartup, deviceReady]);
    const startedDaemon = daemonProcess;
    await finishRemoteSessionAsync({
      logger,
      sessionFailed,
      teardown: [
        ['agent-device tunnel', agentDeviceTunnel?.stopAsync()],
        [
          'agent-device daemon',
          startedDaemon &&
            (async () => {
              try {
                if (eventCollection) {
                  await stopAgentDeviceEventCollectionSafelyAsync({
                    eventCollection,
                    deviceRunSessionId,
                    logger,
                  });
                }
              } finally {
                await startedDaemon.stopAsync();
              }
            })(),
        ],
        ['session host', sessionHost?.finishAsync()],
      ],
    });
  }
}

export async function startAgentDeviceDaemonAsync({
  packageVersion,
  env,
  logger,
  signal,
  secrets,
}: {
  packageVersion: string | undefined;
  env: BuildStepEnv;
  logger: bunyan;
  /** Kills the install and stops before the daemon starts, when aborted. No git fallback then. */
  signal?: AbortSignal;
  secrets?: string[];
}): Promise<DetachedProcessHandle> {
  signal?.throwIfAborted();
  const packageSpec = createAgentDevicePackageSpec(packageVersion);
  const packageManager = resolveConfiguredPackageManager(env, PackageManager.BUN);
  const installDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'eas-agent-device-'));
  await fs.promises.writeFile(
    path.join(installDir, 'package.json'),
    `${JSON.stringify({ name: 'eas-agent-device', private: true })}\n`
  );

  try {
    signal?.throwIfAborted();
    const add = resolvePackageAdd(packageManager, packageSpec);
    logger.info(`Installing ${packageSpec} with ${add.command}.`);
    await spawn(add.command, add.args, { cwd: installDir, env, logger, signal });

    const daemonPath = getInstalledAgentDeviceDaemonPath(installDir);
    if (!fs.existsSync(daemonPath)) {
      throw new SystemError(`Expected agent-device daemon entry at ${daemonPath}.`);
    }

    signal?.throwIfAborted();
    logger.info(`Launching daemon from ${daemonPath} after ${add.command} install.`);
    const daemonProcess = spawnDetached({
      command: 'node',
      args: [daemonPath],
      env: { ...env, ...AGENT_DEVICE_DAEMON_ENV },
      logger,
      secrets,
    });
    return {
      ...daemonProcess,
      stopAsync: async () => {
        try {
          await daemonProcess.stopAsync();
        } finally {
          await fs.promises.rm(installDir, { recursive: true, force: true });
        }
      },
    };
  } catch (err) {
    await fs.promises.rm(installDir, { recursive: true, force: true });
    // An abort is not an install problem: stop instead of falling back to git.
    if (signal?.aborted) {
      throw err;
    }
    const error = err instanceof Error ? err : new Error(String(err));
    const bunVersion = await getBunVersionForDiagnosticsAsync(env);
    Sentry.capture(
      'Failed to start agent-device daemon from the configured package manager; falling back to git clone',
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
          packageManager,
          bunVersion,
        },
      }
    );
    logger.warn(
      `Failed to start daemon from ${packageSpec} via ${packageManager}; falling back to git clone: ${error.message}`
    );
    return await startAgentDeviceDaemonFromGitAsync({
      packageVersion,
      env,
      logger,
      signal,
      secrets,
    });
  }
}

export async function stopAgentDeviceEventCollectionSafelyAsync({
  eventCollection,
  deviceRunSessionId,
  logger,
}: {
  eventCollection: { stopAsync: () => Promise<void> };
  deviceRunSessionId: string;
  logger: bunyan;
}): Promise<void> {
  try {
    await eventCollection.stopAsync();
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    Sentry.capture('Could not finish agent-device session event collection', error, {
      level: 'warning',
      tags: { phase: 'agent-device-event-collection', operation: 'stop' },
      extras: { deviceRunSessionId },
    });
    logger.warn({ err: error }, 'Could not finish agent-device session event collection.');
  }
}

async function startAgentDeviceDaemonFromGitAsync({
  packageVersion,
  env,
  logger,
  signal,
  secrets,
}: {
  packageVersion: string | undefined;
  env: BuildStepEnv;
  logger: bunyan;
  signal?: AbortSignal;
  secrets?: string[];
}): Promise<DetachedProcessHandle> {
  logger.info(
    packageVersion
      ? `Cloning agent-device @ v${packageVersion} into ${SRC_DIR}.`
      : `Cloning agent-device (latest) into ${SRC_DIR}.`
  );
  await cloneAgentDeviceAsync({ packageVersion, env, logger, signal });

  const packageManager = resolveConfiguredPackageManager(env, PackageManager.BUN);
  const install = resolvePackageInstall(packageManager, { production: true });
  logger.info(`Installing agent-device dependencies with ${install.command}.`);
  await spawn(install.command, install.args, {
    cwd: SRC_DIR,
    env,
    logger,
    signal,
  });

  signal?.throwIfAborted();
  logger.info('Launching daemon from cloned agent-device source.');
  // Git fallback is TypeScript source. The published path runs node on dist JS.
  return spawnDetached({
    command: 'bun',
    args: ['run', 'src/daemon.ts'],
    cwd: SRC_DIR,
    env: { ...env, ...AGENT_DEVICE_DAEMON_ENV },
    logger,
    secrets,
  });
}

async function cloneAgentDeviceAsync({
  packageVersion,
  env,
  logger,
  signal,
}: {
  packageVersion: string | undefined;
  env: BuildStepEnv;
  logger: bunyan;
  signal?: AbortSignal;
}): Promise<void> {
  const branchArgs = packageVersion ? ['--branch', `v${packageVersion}`] : [];
  await spawn('git', ['clone', '--depth', '1', ...branchArgs, AGENT_DEVICE_REPO_URL, SRC_DIR], {
    env,
    logger,
    signal,
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

function getInstalledAgentDeviceDaemonPath(installDir: string): string {
  return path.join(
    installDir,
    'node_modules',
    AGENT_DEVICE_PACKAGE_NAME,
    'dist',
    'src',
    'internal',
    'daemon.js'
  );
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
