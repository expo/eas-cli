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
import { isProcessDescendantOfAsync } from '../../utils/processes';
import { sleepAsync } from '../../utils/retry';
import { pollArgentArtifactsForUploadAsync } from '../utils/argentArtifacts';
import {
  fetchNgrokCredentialAsync,
  getDeviceRunSessionIdOrThrow,
  getNgrokTunnelDomainOrThrow,
  selectXcodeDeveloperDirectoryAsync,
  spawnDetached,
  startNgrokTunnelAsync,
  startServeSimWithTunnelAsync,
  uploadRemoteSessionConfigAsync,
  waitForDeviceRunSessionStoppedAsync,
} from '../utils/remoteDeviceRunSession';

const ARGENT_PACKAGE_NAME = '@swmansion/argent';
export const MIN_ARGENT_REMOTE_SESSION_VERSION = '0.12.0';
const ARGENT_ARTIFACTS_LIST_ENDPOINT_FLAG = 'artifacts-list-endpoint';
const ARGENT_STATE_DIR = path.join(os.homedir(), '.argent');
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
    ],
    fn: async ({ logger, global }, { inputs, env, signal }) => {
      // Fail fast before any expensive setup if the session context is
      // incomplete: DEVICE_RUN_SESSION_ID (to report the remote config back to
      // the API server), EAS_SIMULATOR_NGROK_TUNNEL_DOMAIN (base domain for our
      // ngrok tunnels), and a session-scoped ngrok authtoken minted by the API
      // server (to authenticate them).
      const deviceRunSessionId = getDeviceRunSessionIdOrThrow(env);
      const ngrokTunnelDomain = getNgrokTunnelDomainOrThrow(env);
      const ngrokCredential = await fetchNgrokCredentialAsync(ctx, { env, logger });

      const packageVersion = inputs.package_version.value as string | undefined;
      warnIfArgentPackageVersionCannotBeVerified({ packageVersion, logger });
      const versionSpec = packageVersion ?? 'latest';
      const { runtimePlatform } = global;
      logger.info(
        `Starting argent remote session (version: ${versionSpec}, runtime: ${runtimePlatform}).`
      );

      if (runtimePlatform === BuildRuntimePlatform.DARWIN) {
        await selectXcodeDeveloperDirectoryAsync({ env, logger });
      }

      logger.info('Enabling the Argent artifacts list endpoint flag.');
      await spawn(
        'bunx',
        [`${ARGENT_PACKAGE_NAME}@${versionSpec}`, 'enable', ARGENT_ARTIFACTS_LIST_ENDPOINT_FLAG],
        { env, logger }
      );

      logger.info(`Launching ${ARGENT_PACKAGE_NAME}@${versionSpec} tool-server via bunx.`);
      // Keep Argent itself in foreground mode under the detached bunx process. This preserves
      // the bunx -> Argent CLI -> tool-server ancestry used to identify the matching state file.
      const argentServer = spawnDetached({
        command: 'bunx',
        args: [
          `${ARGENT_PACKAGE_NAME}@${versionSpec}`,
          'server',
          'start',
          '--port',
          '0',
          '--idle-timeout',
          '0',
          '--force',
        ],
        env,
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

      try {
        const publicToolsUrl = await startNgrokTunnelAsync({
          port: toolServerPort,
          subdomainPrefix: 'argent',
          baseDomain: ngrokTunnelDomain,
          hostname: ngrokCredential.remoteSessionHostname,
          authtoken: ngrokCredential.authtoken,
          rewriteHostHeader: true,
          logger,
        });
        logger.info(`Tunnel is ready at ${publicToolsUrl}.`);

        // serve-sim is iOS-only — Android sessions go without a preview URL.
        let webPreviewUrl: string | undefined;
        if (runtimePlatform === BuildRuntimePlatform.DARWIN) {
          const serveSim = await startServeSimWithTunnelAsync(ctx, {
            baseDomain: ngrokTunnelDomain,
            ngrokCredential,
            env,
            logger,
            timeoutMs: STARTUP_TIMEOUT_MS,
          });
          webPreviewUrl = serveSim.previewUrl;
          logger.info(`Web preview URL: ${webPreviewUrl}`);
        }

        await uploadRemoteSessionConfigAsync({
          ctx,
          deviceRunSessionId,
          remoteConfig: {
            toolsUrl: publicToolsUrl,
            ...(toolServerToken ? { toolsAuthToken: toolServerToken } : {}),
            ...(webPreviewUrl ? { webPreviewUrl } : {}),
          },
          logger,
        });

        await waitForDeviceRunSessionStoppedAsync({
          ctx,
          deviceRunSessionId,
          logger,
          signal,
        });
      } finally {
        artifactPollAbortController.abort();
        try {
          await artifactPollingPromise;
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          Sentry.capture('Could not finish Argent remote session artifact polling', error);
          logger.warn({ err: error }, 'Could not finish Argent remote session artifact polling.');
        }
      }
    },
  });
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
        `Continuing and letting bunx resolve it.`
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
