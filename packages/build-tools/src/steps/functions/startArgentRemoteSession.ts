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
import { pollArgentArtifactsForUploadAsync } from '../utils/argentArtifacts';
import {
  getDeviceRunSessionIdOrThrow,
  getNgrokAuthtokenOrThrow,
  getNgrokTunnelDomainOrThrow,
  selectXcodeDeveloperDirectoryAsync,
  spawnDetached,
  startNgrokTunnelAsync,
  startServeSimWithTunnelAsync,
  uploadRemoteSessionConfigAsync,
  waitForDeviceRunSessionStoppedAsync,
  waitForFileAsync,
} from '../utils/remoteDeviceRunSession';

const ARGENT_PACKAGE_NAME = '@swmansion/argent';
export const MIN_ARGENT_REMOTE_SESSION_VERSION = '0.12.0';
const ARGENT_ARTIFACTS_LIST_ENDPOINT_FLAG = 'artifacts-list-endpoint';
const ARGENT_STATE_FILE = path.join(os.homedir(), '.argent', 'tool-server.json');
const STARTUP_TIMEOUT_MS = 60_000;

const ArgentToolServerStateSchema = z.object({
  port: z.number(),
  token: z.string().optional(),
});

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
      // Fail fast before any expensive setup if the injected env
      // vars are missing: DEVICE_RUN_SESSION_ID (to report the remote config
      // back to the API server), EAS_SIMULATOR_NGROK_TUNNEL_DOMAIN (base domain
      // for our ngrok tunnels), and NGROK_AUTHTOKEN (to authenticate them).
      const deviceRunSessionId = getDeviceRunSessionIdOrThrow(env);
      const ngrokTunnelDomain = getNgrokTunnelDomainOrThrow(env);
      const ngrokAuthtoken = getNgrokAuthtokenOrThrow(env);

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

      // Stale state from a previous run would mask the new server's port.
      await fs.promises.rm(ARGENT_STATE_FILE, { force: true });
      logger.info('Enabling the Argent artifacts list endpoint flag.');
      await spawn(
        'bunx',
        [`${ARGENT_PACKAGE_NAME}@${versionSpec}`, 'enable', ARGENT_ARTIFACTS_LIST_ENDPOINT_FLAG],
        { env, logger }
      );

      logger.info(`Launching ${ARGENT_PACKAGE_NAME}@${versionSpec} tool-server via bunx.`);
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
          '--detach',
        ],
        env,
      });

      logger.info(`Waiting for argent tool-server state at ${ARGENT_STATE_FILE}.`);
      let toolServerPort: number;
      let toolServerToken: string | undefined;
      try {
        const toolServerState = await waitForFileAsync({
          filePath: ARGENT_STATE_FILE,
          timeoutMs: STARTUP_TIMEOUT_MS,
          description: 'argent tool-server state',
          parse: parseArgentToolServerState,
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
          authtoken: ngrokAuthtoken,
          rewriteHostHeader: true,
          logger,
        });
        logger.info(`Tunnel is ready at ${publicToolsUrl}.`);

        // serve-sim is iOS-only — Android sessions go without a preview URL.
        let webPreviewUrl: string | undefined;
        if (runtimePlatform === BuildRuntimePlatform.DARWIN) {
          const serveSim = await startServeSimWithTunnelAsync(ctx, {
            baseDomain: ngrokTunnelDomain,
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

function parseArgentToolServerState(raw: string): { port: number; token?: string } {
  const result = ArgentToolServerStateSchema.safeParse(JSON.parse(raw));
  if (!result.success) {
    throw new SystemError(
      `Expected tool-server state to contain { "port": <number>, ... }: ${result.error.message}`
    );
  }
  return result.data;
}
