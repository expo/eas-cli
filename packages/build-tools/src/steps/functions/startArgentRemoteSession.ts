import { SystemError } from '@expo/eas-build-job';
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
import { z } from 'zod';

import { CustomBuildContext } from '../../customBuildContext';
import {
  ensureNgrokInstalledAsync,
  getDeviceRunSessionIdOrThrow,
  getNgrokTunnelDomainOrThrow,
  spawnDetached,
  startNgrokTunnelAsync,
  startServeSimWithTunnelAsync,
  uploadRemoteSessionConfigAsync,
  waitForFileAsync,
} from '../utils/remoteDeviceRunSession';

const ARGENT_PACKAGE_NAME = '@swmansion/argent';
const ARGENT_STATE_FILE = path.join(os.homedir(), '.argent', 'tool-server.json');
const XCODE_DEVELOPER_DIR = '/Applications/Xcode.app/Contents/Developer';
const STARTUP_TIMEOUT_MS = 60_000;

const ArgentToolServerStateSchema = z.object({ port: z.number() });

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
      // Fail fast before any expensive setup if the orchestrator-injected env
      // vars are missing: DEVICE_RUN_SESSION_ID (needed to report the remote
      // config back to the API server) and EAS_SIMULATOR_NGROK_TUNNEL_DOMAIN
      // (the base domain for the ngrok tunnels we open below).
      const deviceRunSessionId = getDeviceRunSessionIdOrThrow(env);
      const ngrokTunnelDomain = getNgrokTunnelDomainOrThrow(env);

      const packageVersion = inputs.package_version.value as string | undefined;
      const versionSpec = packageVersion ?? 'latest';
      const { runtimePlatform } = global;
      logger.info(
        `Starting argent remote session (version: ${versionSpec}, runtime: ${runtimePlatform}).`
      );

      if (runtimePlatform === BuildRuntimePlatform.DARWIN) {
        logger.info(`Selecting Xcode developer directory: ${XCODE_DEVELOPER_DIR}.`);
        await spawn('sudo', ['xcode-select', '-s', XCODE_DEVELOPER_DIR], { env, logger });
      }

      logger.info('Ensuring ngrok is installed.');
      const ngrokCommand = await ensureNgrokInstalledAsync({
        runtimePlatform,
        env,
        logger,
      });

      // Stale state from a previous run would mask the new server's port.
      await fs.promises.rm(ARGENT_STATE_FILE, { force: true });

      logger.info(`Launching ${ARGENT_PACKAGE_NAME}@${versionSpec} via bunx.`);
      // `argent mcp` is the public entry that triggers @argent/tools-client
      // to spawn the tool-server detached + unref'd, so the tool-server
      // outlives this MCP process. ARGENT_IDLE_TIMEOUT_MINUTES=0 disables the
      // 30-min idle shutdown that would otherwise tear the tunnel down.
      spawnDetached({
        command: 'bunx',
        args: [`${ARGENT_PACKAGE_NAME}@${versionSpec}`, 'mcp'],
        env: { ...env, ARGENT_IDLE_TIMEOUT_MINUTES: '0' },
      });

      logger.info(`Waiting for argent tool-server state at ${ARGENT_STATE_FILE}.`);
      const { port: toolServerPort } = await waitForFileAsync({
        filePath: ARGENT_STATE_FILE,
        timeoutMs: STARTUP_TIMEOUT_MS,
        description: 'argent tool-server state',
        parse: parseArgentToolServerState,
      });
      logger.info(`Argent tool-server is listening on port ${toolServerPort}.`);

      const toolsUrl = await startNgrokTunnelAsync({
        ngrokCommand,
        port: toolServerPort,
        subdomainPrefix: 'argent',
        baseDomain: ngrokTunnelDomain,
        env,
        logger,
        timeoutMs: STARTUP_TIMEOUT_MS,
      });
      logger.info(`Tunnel is ready at ${toolsUrl}.`);

      // serve-sim is iOS-only — Android sessions go without a preview URL.
      let webPreviewUrl: string | undefined;
      if (runtimePlatform === BuildRuntimePlatform.DARWIN) {
        const serveSim = await startServeSimWithTunnelAsync({
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
          toolsUrl,
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

function parseArgentToolServerState(raw: string): { port: number } {
  const result = ArgentToolServerStateSchema.safeParse(JSON.parse(raw));
  if (!result.success) {
    throw new SystemError(
      `Expected tool-server state to contain { "port": <number>, ... }: ${result.error.message}`
    );
  }
  return result.data;
}
