import { GenericArtifactType, SystemError } from '@expo/eas-build-job';
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
import { sleepAsync } from '../../utils/retry';
import {
  type AgentDeviceMediaCollector,
  startAgentDeviceMediaCollector,
  stopActiveAgentDeviceRecordingsAsync,
} from '../utils/agentDeviceArtifacts';
import {
  type DetachedProcessHandle,
  getDeviceRunSessionIdOrThrow,
  getNgrokAuthtokenOrThrow,
  getNgrokTunnelDomainOrThrow,
  isDeviceRunSessionFinalAsync,
  spawnDetached,
  startNgrokTunnelAsync,
  startServeSimWithTunnelAsync,
  uploadRemoteSessionConfigAsync,
  waitForFileAsync,
} from '../utils/remoteDeviceRunSession';

const AGENT_DEVICE_PACKAGE_NAME = 'agent-device';
const AGENT_DEVICE_REPO_URL = 'https://github.com/callstackincubator/agent-device.git';
const SRC_DIR = '/tmp/agent-device-src';
const DAEMON_JSON_PATH = path.join(os.homedir(), '.agent-device', 'daemon.json');
const XCODE_DEVELOPER_DIR = '/Applications/Xcode.app/Contents/Developer';
const STARTUP_TIMEOUT_MS = 60_000;
const ARTIFACTS_DIR = path.join(os.tmpdir(), 'eas-drs-artifacts');

const SESSION_STATUS_POLL_INTERVAL_MS = 5_000;
const SELF_DEADLINE_SAFETY_MARGIN_MS = 5 * 60 * 1000;

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
      const stepStartTimestampMs = Date.now();

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

      // The user can stop the session while setup is still running - www
      // marks it final immediately. Bail out before the daemon setup instead
      // of finishing it for a dead session.
      if (await isDeviceRunSessionFinalAsync({ ctx, deviceRunSessionId, logger })) {
        logger.info('The device run session was stopped during setup. Exiting.');
        return;
      }

      // Start collecting agent-device media files (screenshots and screen
      // recordings) before the daemon launches, so nothing is missed. The
      // collected files are uploaded as session artifacts when the session
      // ends.
      let mediaCollector: AgentDeviceMediaCollector | null = null;
      try {
        await fs.promises.mkdir(ARTIFACTS_DIR, { recursive: true });
        mediaCollector = startAgentDeviceMediaCollector({
          artifactsDir: ARTIFACTS_DIR,
          logger,
        });
        logger.info(`Collecting agent-device media files into ${ARTIFACTS_DIR}.`);
      } catch (err) {
        // Artifact collection is best-effort - never fail the session for it.
        logger.warn({ err }, 'Failed to start the agent-device media collector.');
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

      const selfDeadlineTimestampMs = computeSelfDeadlineTimestampMs({ stepStartTimestampMs, env });
      if (selfDeadlineTimestampMs !== null) {
        logger.info(
          `The session will end automatically at ${new Date(
            selfDeadlineTimestampMs
          ).toISOString()}, before the job's maximum runtime elapses.`
        );
      }

      // Keep the turtle job alive (the daemon and tunnel stay reachable) by
      // polling the session status in www until the user stops the session
      // (or it errors), or until the self-deadline passes.
      logger.info('Remote session is live. Keeping the job alive until the session is stopped.');
      await waitForSessionToEndAsync({ ctx, deviceRunSessionId, selfDeadlineTimestampMs, logger });

      // The session is over. Persist the collected media as session
      // artifacts, then return normally so the job finishes as a regular
      // success - artifact failures are logged warnings, never job errors.
      try {
        logger.info('Collecting agent-device session artifacts.');
        // Finalize in-flight recordings through agent-device's own pipeline
        // so the uploaded videos are playable; daemon shutdown alone would
        // leave them truncated.
        await stopActiveAgentDeviceRecordingsAsync({
          daemonPort,
          daemonToken,
          artifactsDir: ARTIFACTS_DIR,
          logger,
        });
        if (mediaCollector) {
          await mediaCollector.sweepAsync();
          mediaCollector.stop();
        }
        await uploadCollectedArtifactsAsync({ ctx, logger });
      } catch (err) {
        logger.warn({ err }, 'Failed to collect agent-device session artifacts.');
      }
      logger.info('The device run session has ended. Finishing the job.');
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
      env: { ...env, AGENT_DEVICE_DAEMON_SERVER_MODE: 'http' },
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
    env: { ...env, AGENT_DEVICE_DAEMON_SERVER_MODE: 'http' },
  });
}

/**
 * Computes the timestamp at which the step should end the session on its own
 * to stay ahead of the orchestrator's hard job timeout. The maximum job
 * runtime comes from `__MAX_RUN_TIME_SECONDS` (injected into generic job
 * envs by the API server; absent on older jobs - then there is no
 * self-deadline and we rely on the orchestrator timeout alone).
 *
 * The job's runtime clock started when the orchestrator claimed the job -
 * before the VM booted and this step started - so measuring the full max
 * runtime from the step's start would overshoot the real deadline. The
 * safety margin absorbs that spinup/setup skew and leaves time for the
 * post-session artifact collection and upload. The margin is clamped so the
 * deadline is never earlier than half the max runtime past the step's start,
 * keeping the session useful even for very short max runtimes.
 */
function computeSelfDeadlineTimestampMs({
  stepStartTimestampMs,
  env,
}: {
  stepStartTimestampMs: number;
  env: BuildStepEnv;
}): number | null {
  const rawMaxRunTimeSeconds = env.__MAX_RUN_TIME_SECONDS;
  if (!rawMaxRunTimeSeconds) {
    return null;
  }
  const maxRunTimeSeconds = Number(rawMaxRunTimeSeconds);
  if (!Number.isFinite(maxRunTimeSeconds) || maxRunTimeSeconds <= 0) {
    return null;
  }
  const maxRunTimeMs = maxRunTimeSeconds * 1000;
  return (
    stepStartTimestampMs + Math.max(maxRunTimeMs - SELF_DEADLINE_SAFETY_MARGIN_MS, maxRunTimeMs / 2)
  );
}

async function waitForSessionToEndAsync({
  ctx,
  deviceRunSessionId,
  selfDeadlineTimestampMs,
  logger,
}: {
  ctx: CustomBuildContext;
  deviceRunSessionId: string;
  selfDeadlineTimestampMs: number | null;
  logger: bunyan;
}): Promise<void> {
  for (;;) {
    if (selfDeadlineTimestampMs !== null && Date.now() >= selfDeadlineTimestampMs) {
      logger.info(
        'The job is approaching its maximum runtime - ending the session early to leave time for artifact collection and upload.'
      );
      return;
    }
    if (await isDeviceRunSessionFinalAsync({ ctx, deviceRunSessionId, logger })) {
      logger.info('The device run session was stopped.');
      return;
    }
    await sleepAsync(SESSION_STATUS_POLL_INTERVAL_MS);
  }
}

async function uploadCollectedArtifactsAsync({
  ctx,
  logger,
}: {
  ctx: CustomBuildContext;
  logger: bunyan;
}): Promise<void> {
  let entries;
  try {
    entries = await fs.promises.readdir(ARTIFACTS_DIR, { withFileTypes: true });
  } catch (err) {
    logger.warn({ err }, `Failed to read the artifacts directory ${ARTIFACTS_DIR}.`);
    return;
  }

  const fileNames = entries.filter(entry => entry.isFile()).map(entry => entry.name);
  if (fileNames.length === 0) {
    logger.info('No agent-device media files were collected during this session.');
    return;
  }

  logger.info(`Uploading ${fileNames.length} agent-device media file(s) as session artifacts.`);
  for (const fileName of fileNames) {
    try {
      // Each file is uploaded individually (not as a tarball) so the website
      // can render images and videos inline.
      await ctx.runtimeApi.uploadArtifact({
        artifact: {
          type: GenericArtifactType.OTHER,
          name: `agent-device/${fileName}`,
          paths: [path.join(ARTIFACTS_DIR, fileName)],
        },
        logger,
      });
      logger.info(`Uploaded ${fileName}.`);
    } catch (err) {
      logger.warn({ err }, `Failed to upload ${fileName} - continuing with the remaining files.`);
    }
  }
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
