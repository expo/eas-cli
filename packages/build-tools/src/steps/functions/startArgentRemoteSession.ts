import { SystemError } from '@expo/eas-build-job';
import { type bunyan } from '@expo/logger';
import {
  BuildFunction,
  BuildRuntimePlatform,
  BuildStepInput,
  BuildStepInputValueTypeName,
} from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import semver from 'semver';
import { z } from 'zod';

import { CustomBuildContext } from '../../customBuildContext';
import { Sentry } from '../../sentry';
import { PackageManager, resolveOverridePackageManager, resolvePackageExec } from '../../utils/packageManager';
import { isProcessDescendantOfAsync } from '../../utils/processes';
import { sleepAsync } from '../../utils/retry';
import { pollArgentArtifactsForUploadAsync } from '../utils/argentArtifacts';
import { ARGENT_EVENT_LOG_FILENAME, startArgentEventCollectionAsync } from '../utils/argentEvents';
import {
  ensureFfmpegInstalledOnceAsync,
  getDeviceRunSessionIdOrThrow,
  getNgrokAuthtokenOrThrow,
  getNgrokTunnelDomainOrThrow,
  selectXcodeDeveloperDirectoryAsync,
  spawnDetached,
  startDeviceWebPreviewWithTunnelAsync,
  startNgrokTunnelAsync,
  uploadRemoteSessionConfigAsync,
  waitForDeviceRunSessionStoppedAsync,
} from '../utils/remoteDeviceRunSession';

const ARGENT_PACKAGE_NAME = '@swmansion/argent';
// 0.16.0 is the first version that exposes the tool-server event log flag; keeping the floor
// here lets us enable it (and the artifacts list endpoint) unconditionally below.
export const MIN_ARGENT_REMOTE_SESSION_VERSION = '0.16.0';
const ARGENT_ARTIFACTS_LIST_ENDPOINT_FLAG = 'artifacts-list-endpoint';
// Tells the tool-server to write its structured event log so we can collect session events.
const ARGENT_EVENT_LOG_FLAG = 'tool-server-event-log';
const ARGENT_STATE_DIR = path.join(os.homedir(), '.argent');
// Pin the event log path explicitly and hand the same value to the tool-server (via
// ARGENT_EVENT_LOG) and the collector, so an ambient ARGENT_EVENT_LOG or a future change to
// Argent's default can never make the two disagree.
const ARGENT_EVENT_LOG_PATH = path.join(ARGENT_STATE_DIR, ARGENT_EVENT_LOG_FILENAME);
const STARTUP_TIMEOUT_MS = 60_000;

const ArgentToolServerStateSchema = z.object({
  port: z.number(),
  pid: z.number(),
  token: z.string().optional(),
});

type ArgentToolServerState = z.infer<typeof ArgentToolServerStateSchema>;

export function createStartArgentRemoteSessionBuildFunction(
  ctx: CustomBuildContext
): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'start_argent_remote_session',
    name: 'Start argent remote session',
    __metricsId: 'eas/start_argent_remote_session',
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'package_version',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'max_idle_time_minutes',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.NUMBER,
      }),
      BuildStepInput.createProvider({
        id: 'max_duration_seconds',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.NUMBER,
      }),
    ],
    fn: async ({ logger, global }, { inputs, env, signal }) => {
      // Fail fast before any expensive setup if the injected env
      // vars are missing: DEVICE_RUN_SESSION_ID (to report the remote config
      // back to the API server), EAS_SIMULATOR_NGROK_TUNNEL_DOMAIN (base domain
      // for our ngrok tunnels), and NGROK_AUTHTOKEN (to authenticate them).
      const deviceRunSessionId = getDeviceRunSessionIdOrThrow(env);
      const ngrokTunnelDomain = getNgrokTunnelDomainOrThrow(env);
      const ngrokAuthtoken = getNgrokAuthtokenOrThrow(env);

      const packageVersion = inputs.package_version.value as string | undefined;
      // A missing or non-positive value disables the idle timeout (opt-in feature).
      const maxIdleTimeMinutes = inputs.max_idle_time_minutes.value as number | undefined;
      const maxDurationSeconds = inputs.max_duration_seconds?.value as number | undefined;
      warnIfArgentPackageVersionCannotBeVerified({ packageVersion, logger });
      const versionSpec = packageVersion ?? 'latest';
      const { runtimePlatform } = global;
      logger.info(
        `Starting argent remote session (version: ${versionSpec}, runtime: ${runtimePlatform}).`
      );

      if (runtimePlatform === BuildRuntimePlatform.DARWIN) {
        await selectXcodeDeveloperDirectoryAsync({ env, logger });
      }

      // Start the potentially slow installation while Argent is being prepared.
      // On Linux expo-device-hub calls this again and awaits the same in-flight
      // setup before launching. On macOS this remains non-blocking, so only a
      // recording started in the first moments may miss ffmpeg.
      // Never rejects, so `void` is safe.
      void ensureFfmpegInstalledOnceAsync({ runtimePlatform, env, logger });

      const packageManager = resolveOverridePackageManager(env) ?? PackageManager.BUN;
      const argentExec = (args: string[]): { command: string; args: string[] } =>
        resolvePackageExec(packageManager, args);

      logger.info('Enabling the Argent artifacts list endpoint flag.');
      const enableArtifacts = argentExec([
        `${ARGENT_PACKAGE_NAME}@${versionSpec}`,
        'enable',
        ARGENT_ARTIFACTS_LIST_ENDPOINT_FLAG,
      ]);
      await spawn(enableArtifacts.command, enableArtifacts.args, { env, logger });

      logger.info('Enabling the Argent tool-server event log flag.');
      const enableEventLog = argentExec([
        `${ARGENT_PACKAGE_NAME}@${versionSpec}`,
        'enable',
        ARGENT_EVENT_LOG_FLAG,
      ]);
      await spawn(enableEventLog.command, enableEventLog.args, { env, logger });

      const startServer = argentExec([
        `${ARGENT_PACKAGE_NAME}@${versionSpec}`,
        'server',
        'start',
        '--port',
        '0',
        '--idle-timeout',
        '0',
        '--force',
      ]);
      logger.info(
        `Launching ${ARGENT_PACKAGE_NAME}@${versionSpec} tool-server via ${startServer.command}.`
      );
      // Keep Argent itself in foreground mode under the detached process. This preserves
      // the package runner -> Argent CLI -> tool-server ancestry used to identify the matching state file.
      const argentServer = spawnDetached({
        command: startServer.command,
        args: startServer.args,
        env: { ...env, ARGENT_EVENT_LOG: ARGENT_EVENT_LOG_PATH },
      });
      if (argentServer.pid === undefined) {
        throw new SystemError(
          'Failed to start Argent: could not determine the PID of the launched process.'
        );
      }

      logger.info(`Waiting for argent tool-server state in ${ARGENT_STATE_DIR}.`);
      let toolServerPort: number;
      let toolServerToken: string | undefined;
      try {
        const toolServerState = await waitForArgentToolServerStateAsync({
          stateDir: ARGENT_STATE_DIR,
          ancestorPid: argentServer.pid,
          timeoutMs: STARTUP_TIMEOUT_MS,
        });
        toolServerPort = toolServerState.port;
        toolServerToken = toolServerState.token;
      } catch (err) {
        const output = argentServer.getOutput();
        throw new SystemError(
          `${
            err instanceof Error ? err.message : `Timed out waiting for argent tool-server state.`
          }${output ? `\nArgent tool-server output:\n${output}` : ''}`
        );
      }
      logger.info(`Argent tool-server is listening on port ${toolServerPort}.`);
      const artifactPollAbortController = new AbortController();
      const artifactPollSignal = signal
        ? AbortSignal.any([signal, artifactPollAbortController.signal])
        : artifactPollAbortController.signal;
      const artifactPollingPromise = pollArgentArtifactsForUploadAsync(ctx, {
        deviceRunSessionId,
        toolsUrl: `http://127.0.0.1:${toolServerPort}`,
        toolsAuthToken: toolServerToken,
        logger,
        signal: artifactPollSignal,
      });

      const eventCollection = await startArgentEventCollectionAsync({
        ctx,
        deviceRunSessionId,
        eventLogPath: ARGENT_EVENT_LOG_PATH,
        logger,
      });

      let toolsTunnel: Awaited<ReturnType<typeof startNgrokTunnelAsync>> | undefined;
      let webPreview: Awaited<ReturnType<typeof startDeviceWebPreviewWithTunnelAsync>> | undefined;
      try {
        toolsTunnel = await startNgrokTunnelAsync({
          port: toolServerPort,
          subdomainPrefix: 'argent',
          baseDomain: ngrokTunnelDomain,
          authtoken: ngrokAuthtoken,
          rewriteHostHeader: true,
          logger,
        });
        const publicToolsUrl = toolsTunnel.url;
        logger.info(`Tunnel is ready at ${publicToolsUrl}.`);

        webPreview = await startDeviceWebPreviewWithTunnelAsync(ctx, {
          runtimePlatform,
          baseDomain: ngrokTunnelDomain,
          env,
          logger,
          timeoutMs: STARTUP_TIMEOUT_MS,
        });
        logger.info(`Web preview URL: ${webPreview.previewUrl}`);

        await uploadRemoteSessionConfigAsync({
          ctx,
          deviceRunSessionId,
          remoteConfig: {
            toolsUrl: publicToolsUrl,
            ...(toolServerToken ? { toolsAuthToken: toolServerToken } : {}),
            webPreviewUrl: webPreview.previewUrl,
          },
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
      } finally {
        if (webPreview) {
          await webPreview.stopAsync();
        }
        if (toolsTunnel) {
          await toolsTunnel.stopAsync();
        }
        await stopArgentEventCollectionSafelyAsync({ eventCollection, deviceRunSessionId, logger });
        artifactPollAbortController.abort();
        try {
          await artifactPollingPromise;
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          Sentry.capture('Could not finish Argent remote session artifact polling', error);
          logger.warn({ err: error }, 'Could not finish Argent remote session artifact polling.');
        }
        await argentServer.stopAsync();
      }
    },
  });
}

export async function stopArgentEventCollectionSafelyAsync({
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
    Sentry.capture('Could not finish argent session event collection', error, {
      level: 'warning',
      tags: { phase: 'argent-event-collection', operation: 'stop' },
      extras: { deviceRunSessionId },
    });
    logger.warn({ err: error }, 'Could not finish argent session event collection.');
  }
}

export function warnIfArgentPackageVersionCannotBeVerified({
  packageVersion,
  logger,
}: {
  packageVersion: string | undefined;
  logger: bunyan;
}): void {
  if (!packageVersion || packageVersion === 'latest') {
    return;
  }

  const validVersion = semver.valid(packageVersion);
  if (!validVersion) {
    logger.warn(
      `Argent remote simulator sessions require ${ARGENT_PACKAGE_NAME}@${MIN_ARGENT_REMOTE_SESSION_VERSION} or newer, ` +
        `but package_version "${packageVersion}" is not an exact semver version that EAS can verify. ` +
        `Continuing and letting the package manager resolve it.`
    );
    return;
  }

  if (semver.lt(validVersion, MIN_ARGENT_REMOTE_SESSION_VERSION)) {
    throw new SystemError(
      `Argent remote simulator sessions require ${ARGENT_PACKAGE_NAME}@${MIN_ARGENT_REMOTE_SESSION_VERSION} or newer. ` +
        `The requested package_version "${packageVersion}" is too old for the EAS remote-session API. ` +
        `Use "latest" or pass an exact version >= ${MIN_ARGENT_REMOTE_SESSION_VERSION}.`
    );
  }
}

function parseArgentToolServerState(raw: string): ArgentToolServerState {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw new SystemError('Expected tool-server state to contain valid JSON.', { cause: err });
  }
  const result = ArgentToolServerStateSchema.safeParse(json);
  if (!result.success) {
    throw new SystemError(
      `Expected tool-server state to contain { "port": <number>, "pid": <number>, ... }: ${result.error.message}`
    );
  }
  return result.data;
}

export async function waitForArgentToolServerStateAsync({
  stateDir,
  ancestorPid,
  timeoutMs,
  pollIntervalMs = 1_000,
}: {
  stateDir: string;
  ancestorPid: number;
  timeoutMs: number;
  pollIntervalMs?: number;
}): Promise<ArgentToolServerState> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const stateFileNames = (await fs.promises.readdir(stateDir)).filter(
        name => name.startsWith('tool-server') && name.endsWith('.json')
      );
      for (const stateFileName of stateFileNames) {
        try {
          const state = parseArgentToolServerState(
            await fs.promises.readFile(path.join(stateDir, stateFileName), 'utf8')
          );
          if (await isProcessDescendantOfAsync(state.pid, ancestorPid)) {
            return state;
          }
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'ENOENT' && !(err instanceof SystemError)) {
            throw err;
          }
        }
      }
    } catch (err) {
      lastError = err;
    }
    await sleepAsync(pollIntervalMs);
  }

  throw new SystemError(
    `Timed out waiting for an argent tool-server state file belonging to process ${ancestorPid} in ${stateDir}${
      lastError instanceof Error ? `: ${lastError.message}` : ''
    }.`
  );
}
