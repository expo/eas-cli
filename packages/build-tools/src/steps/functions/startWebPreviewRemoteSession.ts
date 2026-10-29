import {
  BuildFunction,
  BuildRuntimePlatform,
  BuildStepInput,
  BuildStepInputValueTypeName,
} from '@expo/steps';

import { CustomBuildContext } from '../../customBuildContext';
import { type DeviceSessionHost, startDeviceSessionHostAsync } from '../utils/deviceSessionHost';
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
import { watchDeviceRunSessionStartup } from '../utils/deviceRunSessionStartup';
import { createStartupTasks } from '../utils/startupTasks';

const STARTUP_TIMEOUT_MS = 60_000;

export function createStartWebPreviewRemoteSessionBuildFunction(
  ctx: CustomBuildContext
): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'start_serve_sim_remote_session',
    name: 'Start web preview remote session',
    __metricsId: 'eas/start_serve_sim_remote_session',
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
      const maxDurationSeconds = inputs.max_duration_seconds?.value as number | undefined;
      const packageVersion = inputs.package_version?.value as string | undefined;
      const { runtimePlatform } = global;
      const startup = createStartupTasks(logger, signal);
      const startupWatch = watchDeviceRunSessionStartup({
        ctx,
        deviceRunSessionId,
        logger,
        startup,
      });
      let sessionHost: DeviceSessionHost | undefined;
      try {
        startup.signal.throwIfAborted();
        if (runtimePlatform === BuildRuntimePlatform.DARWIN) {
          await selectXcodeDeveloperDirectoryAsync({ env, logger });
        }
        const { launch, iosStartup } = await resolveIosSessionStartupAsync({
          runtimePlatform,
          bootSimulator: inputs.boot_simulator?.value as boolean | undefined,
          deviceIdentifier: inputs.device_identifier?.value as string | undefined,
          installAppPath: inputs.install_app_path?.value as string | undefined,
          launchAppIdentifier: inputs.launch_app_identifier?.value,
          launchArgs: inputs.launch_args?.value,
          openUrl: inputs.open_url?.value,
          env,
          logger,
          signal: startup.signal,
        });
        startup.signal.throwIfAborted();
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

        sessionHost = await startDeviceSessionHostAsync(ctx, {
          ...iosStartup,
          runtimePlatform,
          env,
          logger,
          timeoutMs: STARTUP_TIMEOUT_MS,
          signal: startup.signal,
          onStartupError: error => startup.abort(error),
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
        });
        startup.signal.throwIfAborted();

        const webPreview = await sessionHost.openPreviewAsync({
          baseDomain: ngrokTunnelDomain,
          authtoken: ngrokAuthtoken,
        });
        logger.info(
          webPreview.sharePageUrl
            ? `Preview URL: ${webPreview.sharePageUrl} (server: ${webPreview.apiUrl}).`
            : 'Private preview URL unavailable for this session.'
        );
        await uploadRemoteSessionConfigWithLocalEgressAsync({
          env,
          signal: startup.signal,
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
              ? { webPreviewToken: webPreview.previewToken, previewToken: webPreview.previewToken }
              : {}),
          },
          logger,
        });

        await startupWatch.completeAsync();
        await waitForDeviceRunSessionStoppedAsync({
          ctx,
          deviceRunSessionId,
          logger,
          maxDurationSeconds,
          signal,
        });
      } catch (error) {
        if (startupWatch.isStopped()) {
          return;
        }
        throw startup.signal.aborted ? startup.signal.reason : error;
      } finally {
        startup.abort(new Error('Web preview session ended.'));
        await startupWatch.finishAsync();
        await sessionHost?.finishAsync();
      }
    }),
  });
}
