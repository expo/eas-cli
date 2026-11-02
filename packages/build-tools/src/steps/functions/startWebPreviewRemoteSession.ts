import { UserError } from '@expo/eas-build-job';
import {
  BuildFunction,
  BuildRuntimePlatform,
  BuildStepInput,
  BuildStepInputValueTypeName,
} from '@expo/steps';

import { CustomBuildContext } from '../../customBuildContext';
import { startDeviceSessionHostAsync } from '../utils/deviceSessionHost';
import {
  createWarmDeviceSessionServer,
  runOnWarmIosSimulatorAsync,
} from '../utils/warmDeviceSessionHost';
import { type WarmIosSession } from '../utils/warmIosSession';
import { resolveIosSessionStartupAsync } from '../utils/iosSimulatorSession';
import {
  createNetworkCaptureInputProviders,
  parseNetworkCaptureInputs,
} from '../utils/networkCaptureFields';
import {
  uploadRemoteSessionConfigWithLocalEgressAsync,
  withLocalEgressSession,
} from '../utils/localEgressSession';
import {
  createCorsOriginsInputProvider,
  createFrameAncestorsInputProvider,
  createIosSessionStartupInputProviders,
  createPrivatePreviewUrlInputProvider,
  createPublicPreviewInputProvider,
  createServeSimLaunchInputProviders,
  describeServeSimLaunch,
  getDeviceRunSessionIdOrThrow,
  getNgrokAuthtokenOrThrow,
  getNgrokTunnelDomainOrThrow,
  omitNgrokAuthtoken,
  parseCorsOriginsInput,
  parseFrameAncestorsInput,
  selectXcodeDeveloperDirectoryAsync,
  waitForDeviceRunSessionStoppedAsync,
} from '../utils/remoteDeviceRunSession';

const STARTUP_TIMEOUT_MS = 60_000;

export function createStartWebPreviewRemoteSessionBuildFunction(
  ctx: CustomBuildContext,
  { warm = false }: { warm?: boolean } = {}
): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: warm ? 'start_warm_serve_sim_remote_session' : 'start_serve_sim_remote_session',
    name: 'Start web preview remote session',
    __metricsId: warm
      ? 'eas/start_warm_serve_sim_remote_session'
      : 'eas/start_serve_sim_remote_session',
    inputProviders: [
      ...createServeSimLaunchInputProviders(),
      ...createIosSessionStartupInputProviders(),
      ...createNetworkCaptureInputProviders(),
      createPublicPreviewInputProvider(),
      createPrivatePreviewUrlInputProvider(),
      createFrameAncestorsInputProvider(),
      createCorsOriginsInputProvider(),
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
    fn: withLocalEgressSession(async ({ logger, global }, { inputs, env: stepEnv, signal }) => {
      const deviceRunSessionId = getDeviceRunSessionIdOrThrow(stepEnv);
      const ngrokTunnelDomain = getNgrokTunnelDomainOrThrow(stepEnv);
      const ngrokAuthtoken = getNgrokAuthtokenOrThrow(stepEnv);
      const env = omitNgrokAuthtoken(stepEnv);
      const maxIdleTimeMinutes = inputs.max_idle_time_minutes?.value as number | undefined;
      const maxDurationSeconds = inputs.max_duration_seconds?.value as number | undefined;
      const packageVersion = inputs.package_version?.value as string | undefined;
      const { runtimePlatform } = global;
      if (
        maxIdleTimeMinutes !== undefined &&
        maxIdleTimeMinutes > 0 &&
        runtimePlatform !== BuildRuntimePlatform.DARWIN
      ) {
        throw new UserError(
          'UNSUPPORTED_WEB_PREVIEW_IDLE_TIMEOUT',
          'Web preview idle timeouts require iOS preview activity reporting. Omit max_idle_time_minutes for Android sessions.'
        );
      }
      if (runtimePlatform === BuildRuntimePlatform.DARWIN) {
        await selectXcodeDeveloperDirectoryAsync({ env, logger });
      }
      const deviceIdentifier = inputs.device_identifier?.value as string | undefined;
      const startSessionAsync = async (warmSession?: WarmIosSession): Promise<void> => {
        const { launch, iosStartup } = await resolveIosSessionStartupAsync({
          runtimePlatform,
          bootSimulator: inputs.boot_simulator?.value as boolean | undefined,
          deviceIdentifier: warmSession?.device.udid ?? deviceIdentifier,
          installAppPath: inputs.install_app_path?.value as string | undefined,
          launchAppIdentifier: inputs.launch_app_identifier?.value,
          launchArgs: inputs.launch_args?.value,
          openUrl: inputs.open_url?.value,
          env,
          logger,
          signal,
        });
        const { networkCapture, networkCaptureFields } = parseNetworkCaptureInputs(
          {
            networkCapture: inputs.network_capture?.value,
            networkCaptureFields: inputs.network_capture_fields?.value,
          },
          { runtimePlatform }
        );

        logger.info(`Starting web preview remote session (runtime: ${runtimePlatform}).`);
        const launchDescription = describeServeSimLaunch(launch);
        if (launchDescription) {
          logger.info(launchDescription);
        }

        const sessionHost = await startDeviceSessionHostAsync(
          ctx,
          {
            ...iosStartup,
            runtimePlatform,
            env,
            logger,
            timeoutMs: STARTUP_TIMEOUT_MS,
            preview: { baseDomain: ngrokTunnelDomain, authtoken: ngrokAuthtoken },
            signal,
            packageVersion,
            disableShare: inputs.public_preview?.value === false,
            privatePreviewUrl: inputs.private_preview_url?.value as string | undefined,
            frameAncestors: parseFrameAncestorsInput(inputs.frame_ancestors?.value),
            corsOrigins: parseCorsOriginsInput(inputs.cors_origins?.value),
            launchAppIdentifier: launch.launchAppIdentifier,
            launchArgs: launch.launchArgs,
            openUrl: launch.openUrl,
            networkCapture,
            networkCaptureFields,
          },
          ...(warmSession ? [createWarmDeviceSessionServer(ctx, logger, warmSession)] : [])
        );

        try {
          const webPreview = await sessionHost.openPreviewAsync();
          logger.info(
            webPreview.sharePageUrl
              ? `Preview URL: ${webPreview.sharePageUrl} (server: ${webPreview.apiUrl}).`
              : 'Private preview URL unavailable for this session.'
          );
          const sessionStart = await uploadRemoteSessionConfigWithLocalEgressAsync({
            env,
            signal,
            ctx,
            deviceRunSessionId,
            // WEB_PREVIEW_ONLY sessions read webPreviewUrl and webPreviewToken. Legacy SERVE_SIM
            // sessions read previewUrl and previewToken. The server drops the keys that the
            // session type does not use.
            remoteConfig: {
              webPreviewUrl: webPreview.previewPageUrl,
              previewUrl: webPreview.previewPageUrl,
              previewApiUrl: webPreview.apiUrl,
              ...(webPreview.previewToken
                ? {
                    webPreviewToken: webPreview.previewToken,
                    previewToken: webPreview.previewToken,
                  }
                : {}),
            },
            logger,
          });
          if (sessionStart === 'stopped') {
            return;
          }

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
                    getLastEventObservedAt: () => undefined,
                    getLastPreviewActivityAt: () => sessionHost.getLastPreviewActivityAt(),
                  }
                : undefined,
          });
        } finally {
          await sessionHost.finishAsync();
        }
      };
      if (warm && runtimePlatform === BuildRuntimePlatform.DARWIN) {
        await runOnWarmIosSimulatorAsync(
          {
            engine: 'serve-sim',
            requestedDevice: deviceIdentifier,
            packageVersion,
            env,
            logger,
            signal,
          },
          startSessionAsync
        );
      } else {
        await startSessionAsync();
      }
    }),
  });
}
