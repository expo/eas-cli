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
 * agent-device installs at once. Its daemon launches with a daemon policy that confines
 * it to the session's device and denies booting and shutting down devices, so it launches
 * when `device.booted` resolves with that device. The session host also starts then. The
 * session is reported as ready only when both are up and `device.ready` (the app is
 * installed and launched) resolved too.
 *
 * The first failure aborts `tasks.signal`: each part stops before its next stage, and
 * the teardown then stops whatever was started. `device.ready` must settle soon after
 * an abort, because the teardown waits for it.
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
    /** `booted` resolves with the booted device: a Simulator UDID or an emulator serial. */
    device: { booted: Promise<string>; ready: Promise<unknown> };
  }
): Promise<void> {
  logger.info(
    `Starting agent-device remote session (version: ${packageVersion ?? 'latest'}, runtime: ${runtimePlatform}).`
  );

  let daemonProcess: DetachedProcessHandle | undefined;
  let agentDeviceTunnel: Awaited<ReturnType<typeof startNgrokTunnelAsync>> | undefined;
  let sessionHost: DeviceSessionHost | undefined;
  let eventCollection: Awaited<ReturnType<typeof startAgentDeviceEventCollectionAsync>> | undefined;
  let sessionFailed = false;

  // Each task stores what it started, so the teardown below can stop it even when
  // another task failed first.
  const agentDeviceStartup = tasks.run('agent-device daemon', async taskLogger => {
    daemonProcess = await startAgentDeviceDaemonAsync({
      packageVersion,
      env,
      logger: taskLogger,
      signal: tasks.signal,
      // A boot cannot be cancelled, so stop waiting for it when startup is aborted.
      waitForPolicyAsync: async () =>
        createAgentDeviceDaemonPolicy({
          runtimePlatform,
          device: await tasks.untilAborted(device.booted),
        }),
    });

    taskLogger.info(`Waiting for daemon credentials at ${DAEMON_JSON_PATH}.`);
    // The daemon is stored above, so the teardown stops it. The wait itself is bounded
    // (STARTUP_TIMEOUT_MS) and only reads a file, so it may finish in the background.
    const daemonInfo = await tasks.untilAborted(waitForDaemonInfoAsync({ daemonProcess }));
    taskLogger.info(`Daemon is listening on port ${daemonInfo.port}; loaded auth token.`);
    if (!daemonInfo.policyDigest) {
      taskLogger.warn(
        `agent-device ${packageVersion ?? 'latest'} does not enforce daemon policies, so this ` +
          'session is not confined to its device and can boot or shut down devices. ' +
          'Use agent-device 0.21.17 or later.'
      );
    }

    tasks.signal.throwIfAborted();
    agentDeviceTunnel = await startNgrokTunnelAsync({
      port: daemonInfo.port,
      subdomainPrefix: 'agent-device',
      baseDomain: ngrokTunnelDomain,
      authtoken: ngrokAuthtoken,
      logger: taskLogger,
    });
    taskLogger.info(`Tunnel is ready at ${agentDeviceTunnel.url}.`);
    return { ...daemonInfo, remoteSessionUrl: agentDeviceTunnel.url };
  });
  const sessionHostStartup = tasks.run('session host', async taskLogger => {
    // A boot cannot be cancelled, so stop waiting for it when startup is aborted.
    await tasks.untilAborted(device.booted);
    tasks.signal.throwIfAborted();
    sessionHost = await startDeviceSessionHostAsync(ctx, {
      runtimePlatform,
      env,
      logger: taskLogger,
      timeoutMs: STARTUP_TIMEOUT_MS,
      networkCapture: capture.networkCapture,
      networkCaptureFields: capture.networkCaptureFields,
    });
    tasks.signal.throwIfAborted();
    const webPreview = await sessionHost.openPreviewAsync({ baseDomain: ngrokTunnelDomain });
    taskLogger.info(
      `Web preview URL: ${webPreview.previewPageUrl} (server: ${webPreview.apiUrl}).`
    );
    return webPreview;
  });

  try {
    const [
      { port: daemonPort, token: daemonToken, remoteSessionUrl: agentDeviceRemoteSessionUrl },
      webPreview,
    ] = await Promise.all([agentDeviceStartup, sessionHostStartup, device.ready]).catch(
      (err: unknown) => {
        // Also aborts for a `device.ready` that does not come from `tasks.run`.
        tasks.abort(err);
        throw err;
      }
    );
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
    await Promise.allSettled([agentDeviceStartup, sessionHostStartup, device.ready]);
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
  waitForPolicyAsync,
}: {
  packageVersion: string | undefined;
  env: BuildStepEnv;
  logger: bunyan;
  /** Kills the install and stops before the daemon starts, when aborted. No git fallback then. */
  signal?: AbortSignal;
  /**
   * Resolves with the daemon policy. Called after the install, right before the launch, so
   * the install runs while the device that the policy names is still booting.
   */
  waitForPolicyAsync: () => Promise<AgentDeviceDaemonPolicy>;
}): Promise<DetachedProcessHandle> {
  const daemon = await installAgentDeviceDaemonAsync({ packageVersion, env, logger, signal });
  const policyDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'eas-agent-device-policy-'));
  const removeFilesAsync = async (): Promise<void> => {
    await fs.promises.rm(policyDir, { recursive: true, force: true });
    if (daemon.installDir) {
      await fs.promises.rm(daemon.installDir, { recursive: true, force: true });
    }
  };

  try {
    const policy = await waitForPolicyAsync();
    signal?.throwIfAborted();
    const policyPath = path.join(policyDir, 'policy.json');
    await fs.promises.writeFile(policyPath, `${JSON.stringify(policy, null, 2)}\n`);
    logger.info(`${daemon.launchMessage} Daemon policy: ${JSON.stringify(policy)}.`);
    const daemonProcess = spawnDetached({
      command: daemon.command,
      args: daemon.args,
      cwd: daemon.cwd,
      env: { ...env, ...AGENT_DEVICE_DAEMON_ENV, AGENT_DEVICE_DAEMON_POLICY: policyPath },
    });
    return {
      ...daemonProcess,
      stopAsync: async () => {
        try {
          await daemonProcess.stopAsync();
        } finally {
          await removeFilesAsync();
        }
      },
    };
  } catch (err) {
    await removeFilesAsync();
    throw err;
  }
}

/**
 * agent-device's daemon policy (AGENT_DEVICE_DAEMON_POLICY, agent-device 0.21.17 and later):
 * the daemon may use only the session's device, and may not boot or shut down a device, so
 * it cannot reboot it either. The daemon enforces it for every request, including `batch`
 * steps and `replay` actions.
 */
export type AgentDeviceDaemonPolicy = {
  version: 1;
  devices: { allow: [{ udid: string } | { serial: string }] };
  commands: { deny: string[] };
  capabilities: { deny: string[] };
};

function createAgentDeviceDaemonPolicy({
  runtimePlatform,
  device,
}: {
  runtimePlatform: BuildRuntimePlatform;
  /** A Simulator UDID on iOS, an emulator serial on Android. */
  device: string;
}): AgentDeviceDaemonPolicy {
  return {
    version: 1,
    devices: {
      allow: [
        runtimePlatform === BuildRuntimePlatform.LINUX ? { serial: device } : { udid: device },
      ],
    },
    commands: { deny: ['boot', 'shutdown'] },
    // Also denies `close --shutdown`.
    capabilities: { deny: ['device-shutdown'] },
  };
}

type InstalledAgentDeviceDaemon = {
  command: string;
  args: string[];
  cwd?: string;
  /** Removed when the daemon stops. */
  installDir?: string;
  launchMessage: string;
};

async function installAgentDeviceDaemonAsync({
  packageVersion,
  env,
  logger,
  signal,
}: {
  packageVersion: string | undefined;
  env: BuildStepEnv;
  logger: bunyan;
  signal?: AbortSignal;
}): Promise<InstalledAgentDeviceDaemon> {
  const packageSpec = createAgentDevicePackageSpec(packageVersion);
  const packageManager = resolveConfiguredPackageManager(env, PackageManager.BUN);
  const installDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'eas-agent-device-'));
  await fs.promises.writeFile(
    path.join(installDir, 'package.json'),
    `${JSON.stringify({ name: 'eas-agent-device', private: true })}\n`
  );

  try {
    const add = resolvePackageAdd(packageManager, packageSpec);
    logger.info(`Installing ${packageSpec} with ${add.command}.`);
    await spawn(add.command, add.args, { cwd: installDir, env, logger, signal });

    const daemonPath = getInstalledAgentDeviceDaemonPath(installDir);
    if (!fs.existsSync(daemonPath)) {
      throw new SystemError(`Expected agent-device daemon entry at ${daemonPath}.`);
    }
    return {
      command: 'node',
      args: [daemonPath],
      installDir,
      launchMessage: `Launching daemon from ${daemonPath} after ${add.command} install.`,
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
    return await installAgentDeviceDaemonFromGitAsync({ packageVersion, env, logger, signal });
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

async function installAgentDeviceDaemonFromGitAsync({
  packageVersion,
  env,
  logger,
  signal,
}: {
  packageVersion: string | undefined;
  env: BuildStepEnv;
  logger: bunyan;
  signal?: AbortSignal;
}): Promise<InstalledAgentDeviceDaemon> {
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

  // Git fallback is TypeScript source. The published path runs node on dist JS.
  return {
    command: 'bun',
    args: ['run', 'src/daemon.ts'],
    cwd: SRC_DIR,
    launchMessage: 'Launching daemon from cloned agent-device source.',
  };
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
}): Promise<DaemonInfo> {
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

type DaemonInfo = {
  port: number;
  token: string;
  /** Written by a daemon that enforces a daemon policy: agent-device 0.21.17 and later. */
  policyDigest?: string;
};

function parseDaemonInfo(raw: string): DaemonInfo {
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
  const { httpPort, token, policyDigest } = parsed as {
    httpPort: number;
    token: string;
    policyDigest?: unknown;
  };
  return {
    port: httpPort,
    token,
    ...(typeof policyDigest === 'string' ? { policyDigest } : {}),
  };
}
