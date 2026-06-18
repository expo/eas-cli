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
import {
  getDeviceRunSessionIdOrThrow,
  getNgrokAuthtokenOrThrow,
  getNgrokTunnelDomainOrThrow,
  startNgrokTunnelAsync,
  startServeSimWithTunnelAsync,
  uploadRemoteSessionConfigAsync,
  waitForFileAsync,
} from '../utils/remoteDeviceRunSession';

const ARGENT_PACKAGE_NAME = '@swmansion/argent';
const MIN_ARGENT_REMOTE_SESSION_VERSION = '0.11.0';
const ARGENT_STATE_FILE = path.join(os.homedir(), '.argent', 'tool-server.json');
const XCODE_DEVELOPER_DIR = '/Applications/Xcode.app/Contents/Developer';
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
    fn: async ({ logger, global }, { inputs, env }) => {
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
        logger.info(`Selecting Xcode developer directory: ${XCODE_DEVELOPER_DIR}.`);
        await spawn('sudo', ['xcode-select', '-s', XCODE_DEVELOPER_DIR], { env, logger });
      }

      // Stale state from a previous run would mask the new server's port.
      await fs.promises.rm(ARGENT_STATE_FILE, { force: true });

      logger.info(`Launching ${ARGENT_PACKAGE_NAME}@${versionSpec} tool-server via bunx.`);
      await spawn(
        'bunx',
        [
          `${ARGENT_PACKAGE_NAME}@${versionSpec}`,
          'server',
          'start',
          '--port',
          '0',
          '--idle-timeout',
          '0',
          '--detach',
        ],
        { env, logger }
      );

      logger.info(`Waiting for argent tool-server state at ${ARGENT_STATE_FILE}.`);
      const { port: toolServerPort, token: toolServerToken } = await waitForFileAsync({
        filePath: ARGENT_STATE_FILE,
        timeoutMs: STARTUP_TIMEOUT_MS,
        description: 'argent tool-server state',
        parse: parseArgentToolServerState,
      });
      logger.info(`Argent tool-server is listening on port ${toolServerPort}.`);

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

      logger.info('Remote session is live. Keeping the job alive until the session is stopped.');
      // Keep the turtle job alive so the tool-server and tunnel stay reachable
      // until stopDeviceRunSession cancels the run.
      await new Promise<never>(() => {});
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
