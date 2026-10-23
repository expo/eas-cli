import { BuildFunction, BuildRuntimePlatform } from '@expo/steps';

import { type CustomBuildContext } from '../../customBuildContext';
import { pollAgentDeviceArtifactsForUploadAsync } from '../utils/agentDeviceArtifacts';
import { startAgentDeviceEventCollectionAsync } from '../utils/agentDeviceEvents';
import { pollArgentArtifactsForUploadAsync } from '../utils/argentArtifacts';
import { startArgentEventCollectionAsync } from '../utils/argentEvents';
import { type DeviceRunSessionEventCollection } from '../utils/deviceRunSessionEvents';
import { resolveIosSessionStartupAsync } from '../utils/iosSimulatorSession';
import { readLocalEgressHandoffAsync } from '../utils/localEgress';
import { resolveLocalEgressServeSimBootEnvironmentAsync } from '../utils/localEgressGuard';
import {
  uploadRemoteSessionConfigWithLocalEgressAsync,
  withLocalEgressSession,
} from '../utils/localEgressSession';
import { parseNetworkCaptureInputs } from '../utils/networkCaptureFields';
import {
  WarmSessionAdoptionError,
  startWarmDeviceSessionHostAsync,
} from '../utils/warmDeviceSessionHost';
import { stopWarmIosSessionAsync, tryClaimWarmIosSessionAsync } from '../utils/warmIosSession';
import {
  fetchWebPreviewTurnArgsAsync,
  finishRemoteSessionAsync,
  getDeviceRunSessionIdOrThrow,
  getNgrokAuthtokenOrThrow,
  getNgrokTunnelDomainOrThrow,
  omitNgrokAuthtoken,
  parseCorsOriginsInput,
  parseFrameAncestorsInput,
  selectXcodeDeveloperDirectoryAsync,
  startNgrokTunnelAsync,
  waitForDeviceRunSessionStoppedAsync,
} from '../utils/remoteDeviceRunSession';

import { validateControllerVersion } from '../utils/controllerVersion';

import { createStartAgentDeviceSessionBuildFunction } from './startAgentDeviceSession';
import {
  MIN_ARGENT_REMOTE_SESSION_VERSION,
  createStartArgentRemoteSessionBuildFunction,
} from './startArgentRemoteSession';
import { createStartWebPreviewRemoteSessionBuildFunction } from './startWebPreviewRemoteSession';

type Engine = 'serve-sim' | 'agent-device' | 'argent';

export function createStartWarmWebPreviewRemoteSessionBuildFunction(
  ctx: CustomBuildContext
): BuildFunction {
  return createWarmSessionFunction(
    ctx,
    'serve-sim',
    createStartWebPreviewRemoteSessionBuildFunction(ctx)
  );
}

export function createStartWarmAgentDeviceSessionBuildFunction(
  ctx: CustomBuildContext
): BuildFunction {
  return createWarmSessionFunction(
    ctx,
    'agent-device',
    createStartAgentDeviceSessionBuildFunction(ctx)
  );
}

export function createStartWarmArgentRemoteSessionBuildFunction(
  ctx: CustomBuildContext
): BuildFunction {
  return createWarmSessionFunction(ctx, 'argent', createStartArgentRemoteSessionBuildFunction(ctx));
}

function createWarmSessionFunction(
  ctx: CustomBuildContext,
  engine: Engine,
  original: BuildFunction
): BuildFunction {
  const id = original.id.replace('start_', 'start_warm_');
  return new BuildFunction({
    namespace: original.namespace,
    id,
    name: original.name,
    __metricsId: `eas/${id}`,
    inputProviders: original.inputProviders,
    outputProviders: original.outputProviders,
    supportedRuntimePlatforms: original.supportedRuntimePlatforms,
    fn: async (stepsCtx, args) => {
      const { logger, global } = stepsCtx;
      const { inputs, env: stepEnv, signal } = args;
      const env = omitNgrokAuthtoken(stepEnv);
      const fallback = () => original.fn!(stepsCtx, args);
      if (
        global.runtimePlatform !== BuildRuntimePlatform.DARWIN ||
        stepEnv.EAS_USE_WARM_SIMULATOR !== '1' ||
        (await readLocalEgressHandoffAsync()) ||
        Object.keys((await resolveLocalEgressServeSimBootEnvironmentAsync()) ?? {}).length > 0
      ) {
        await stopWarmIosSessionAsync(logger, env);
        return fallback();
      }

      signal?.throwIfAborted();
      const deviceRunSessionId = getDeviceRunSessionIdOrThrow(stepEnv);
      const ngrokAuthtoken = getNgrokAuthtokenOrThrow(stepEnv);
      const ngrokTunnelDomain = getNgrokTunnelDomainOrThrow(stepEnv);
      const packageVersion = inputs.package_version?.value as string | undefined;
      if (engine === 'argent') {
        validateControllerVersion({
          packageName: '@swmansion/argent',
          minimumVersion: MIN_ARGENT_REMOTE_SESSION_VERSION,
          packageVersion,
          logger,
        });
      }
      const capture = parseNetworkCaptureInputs(
        {
          networkCapture: inputs.network_capture?.value,
          networkCaptureFields: inputs.network_capture_fields?.value,
        },
        { runtimePlatform: global.runtimePlatform }
      );
      const turnArgs = fetchWebPreviewTurnArgsAsync(ctx, { logger });
      void turnArgs.catch(() => {});
      try {
        await selectXcodeDeveloperDirectoryAsync({ env, logger });
        const warm = await tryClaimWarmIosSessionAsync({
          engine,
          requestedDevice: inputs.device_identifier?.value as string | undefined,
          packageVersion,
          env,
          logger,
          signal,
        });
        if (!warm) {
          await Promise.allSettled([turnArgs]);
          return fallback();
        }

        let host: Awaited<ReturnType<typeof startWarmDeviceSessionHostAsync>>;
        let toolsTunnelStartup: ReturnType<typeof startNgrokTunnelAsync> | undefined;
        try {
          const { launch, iosStartup } = await resolveIosSessionStartupAsync({
            runtimePlatform: global.runtimePlatform,
            bootSimulator: inputs.boot_simulator?.value as boolean | undefined,
            deviceIdentifier: warm.device.udid,
            installAppPath: inputs.install_app_path?.value as string | undefined,
            launchAppIdentifier: inputs.launch_app_identifier?.value,
            launchArgs: inputs.launch_args?.value,
            openUrl: inputs.open_url?.value,
            env,
            logger,
            signal,
          });
          signal?.throwIfAborted();
          if (engine !== 'serve-sim') {
            if (!warm.tools) {
              throw new Error(`Warm ${engine} did not provide tool credentials.`);
            }
            toolsTunnelStartup = startNgrokTunnelAsync({
              port: warm.tools.port,
              subdomainPrefix: engine,
              baseDomain: ngrokTunnelDomain,
              authtoken: ngrokAuthtoken,
              logger,
              ...(engine === 'argent' ? { rewriteHostHeader: true } : {}),
            });
            void toolsTunnelStartup.catch(() => {});
          }
          host = await startWarmDeviceSessionHostAsync(
            ctx,
            {
              ...iosStartup,
              ...launch,
              runtimePlatform: global.runtimePlatform,
              env,
              logger,
              signal,
              timeoutMs: 60_000,
              preview: { baseDomain: ngrokTunnelDomain, authtoken: ngrokAuthtoken },
              packageVersion: engine === 'serve-sim' ? packageVersion : undefined,
              disableShare: inputs.public_preview?.value === false,
              privatePreviewUrl: inputs.private_preview_url?.value as string | undefined,
              frameAncestors: parseFrameAncestorsInput(inputs.frame_ancestors?.value),
              corsOrigins: parseCorsOriginsInput(inputs.cors_origins?.value),
              ...capture,
            },
            warm,
            { turnArgs }
          );
        } catch (error) {
          const [tunnelCleanup] = await Promise.allSettled([
            toolsTunnelStartup?.then(
              tunnel => tunnel.stopAsync(),
              () => {}
            ),
          ]);
          if (tunnelCleanup.status === 'rejected') {
            logger.warn(
              { err: tunnelCleanup.reason },
              "Could not close the warm session's tool tunnel; it may still be open."
            );
          }
          try {
            await warm.process.stopAsync();
          } catch (cleanupError) {
            logger.warn(
              { err: cleanupError },
              'Could not stop the warm Simulator after startup failed.'
            );
            if (error instanceof WarmSessionAdoptionError) {
              // A cold retry must not share a Simulator with unreleased preparation.
              throw cleanupError;
            }
          }
          if (error instanceof WarmSessionAdoptionError) {
            if (tunnelCleanup.status === 'rejected') {
              throw tunnelCleanup.reason;
            }
            await Promise.allSettled([turnArgs]);
            signal?.throwIfAborted();
            return fallback();
          }
          throw error;
        }

        let sessionCompleted = false;
        try {
          const result = await withLocalEgressSession(async () => {
            const artifactsController = new AbortController();
            const artifactSignal = signal
              ? AbortSignal.any([signal, artifactsController.signal])
              : artifactsController.signal;
            let artifacts: Promise<void> | undefined;
            let events: DeviceRunSessionEventCollection | undefined;
            let toolsTunnel: Awaited<ReturnType<typeof startNgrokTunnelAsync>> | undefined;
            let sessionFailed = false;
            try {
              const tool = warm.tools;
              if (engine !== 'serve-sim') {
                if (!tool) {
                  throw new Error(`Warm ${engine} did not provide tool credentials.`);
                }
                if (engine === 'agent-device') {
                  events = await startAgentDeviceEventCollectionAsync({
                    ctx,
                    deviceRunSessionId,
                    stateDir: warm.agentDeviceStateDir,
                    logger,
                  });
                  signal?.throwIfAborted();
                  artifacts = pollAgentDeviceArtifactsForUploadAsync(ctx, {
                    deviceRunSessionId,
                    daemonUrl: `http://127.0.0.1:${tool.port}`,
                    daemonToken: tool.token,
                    logger,
                    signal,
                    stopPollingSignal: artifactsController.signal,
                  });
                } else {
                  events = await startArgentEventCollectionAsync({
                    ctx,
                    deviceRunSessionId,
                    eventLogPath: warm.argentEventLogPath,
                    logger,
                  });
                  signal?.throwIfAborted();
                  artifacts = pollArgentArtifactsForUploadAsync(ctx, {
                    deviceRunSessionId,
                    toolsUrl: `http://127.0.0.1:${tool.port}`,
                    toolsAuthToken: tool.token,
                    logger,
                    signal: artifactSignal,
                  });
                }
                // Attach a handler immediately; the finalizer still observes and reports rejection.
                void artifacts.catch(() => {});
                toolsTunnel = await toolsTunnelStartup;
                signal?.throwIfAborted();
              }
              const preview = await host.openPreviewAsync();
              signal?.throwIfAborted();
              await uploadRemoteSessionConfigWithLocalEgressAsync({
                env,
                signal,
                ctx,
                deviceRunSessionId,
                logger,
                remoteConfig: {
                  webPreviewUrl: preview.previewPageUrl,
                  previewApiUrl: preview.apiUrl,
                  ...(preview.previewToken ? { webPreviewToken: preview.previewToken } : {}),
                  ...(engine === 'serve-sim'
                    ? {
                        previewUrl: preview.previewPageUrl,
                        ...(preview.previewToken ? { previewToken: preview.previewToken } : {}),
                      }
                    : engine === 'agent-device'
                      ? {
                          agentDeviceRemoteSessionUrl: toolsTunnel!.url,
                          agentDeviceRemoteSessionToken: tool!.token,
                        }
                      : { toolsUrl: toolsTunnel!.url, toolsAuthToken: tool!.token }),
                },
              });
              signal?.throwIfAborted();
              const maxIdleTimeMinutes = inputs.max_idle_time_minutes?.value as number | undefined;
              await waitForDeviceRunSessionStoppedAsync({
                ctx,
                deviceRunSessionId,
                logger,
                signal,
                maxDurationSeconds: inputs.max_duration_seconds?.value as number | undefined,
                ...(maxIdleTimeMinutes && maxIdleTimeMinutes > 0
                  ? {
                      idleTimeout: {
                        maxIdleTimeMinutes,
                        getLastEventObservedAt: () => events?.getLastEventObservedAt(),
                        getLastPreviewActivityAt: () => host.getLastPreviewActivityAt(),
                      },
                    }
                  : {}),
              });
            } catch (error) {
              sessionFailed = true;
              throw error;
            } finally {
              artifactsController.abort();
              await finishRemoteSessionAsync({
                logger,
                sessionFailed,
                teardown: [
                  ['tool events', events?.stopAsync()],
                  ['tool artifacts', artifacts],
                ],
              });
            }
          })(stepsCtx, args);
          sessionCompleted = true;
          return result;
        } finally {
          try {
            await finishRemoteSessionAsync({
              logger,
              sessionFailed: !sessionCompleted,
              teardown: [
                [
                  'tool tunnel',
                  toolsTunnelStartup?.then(
                    tunnel => tunnel.stopAsync(),
                    () => {}
                  ),
                ],
              ],
            });
          } finally {
            await host.finishAsync();
          }
        }
      } finally {
        // The cloud request has its existing timeout/retry and P2P/STUN fallback.
        await Promise.allSettled([turnArgs]);
      }
    },
  });
}
