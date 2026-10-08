import {
  BuildFunction,
  BuildRuntimePlatform,
  BuildStepInput,
  BuildStepInputValueTypeName,
} from '@expo/steps';

import { CustomBuildContext } from '../../customBuildContext';
import { startDeviceSessionHostAsync } from '../utils/deviceSessionHost';
import {
  createNetworkCaptureInputProviders,
  parseNetworkCaptureInputs,
} from '../utils/networkCaptureFields';
import {
  uploadRemoteSessionConfigWithLocalEgressAsync,
  withLocalEgressSession,
} from '../utils/localEgressSession';
import {
  createServeSimLaunchInputProviders,
  describeServeSimLaunch,
  getDeviceRunSessionIdOrThrow,
  getNgrokTunnelDomainOrThrow,
  parseServeSimLaunchInputs,
  selectXcodeDeveloperDirectoryAsync,
  waitForDeviceRunSessionStoppedAsync,
} from '../utils/remoteDeviceRunSession';

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
      ...createNetworkCaptureInputProviders(),
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
    fn: withLocalEgressSession(async ({ logger, global }, { inputs, env, signal }) => {
      const deviceRunSessionId = getDeviceRunSessionIdOrThrow(env);
      const ngrokTunnelDomain = getNgrokTunnelDomainOrThrow(env);
      const maxDurationSeconds = inputs.max_duration_seconds?.value as number | undefined;
      const packageVersion = inputs.package_version?.value as string | undefined;
      const { runtimePlatform } = global;
      const launch = parseServeSimLaunchInputs(
        {
          launchAppIdentifier: inputs.launch_app_identifier?.value as string | undefined,
          launchArgs: inputs.launch_args?.value,
          openUrl: inputs.open_url?.value as string | undefined,
        },
        { runtimePlatform }
      );
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

      if (runtimePlatform === BuildRuntimePlatform.DARWIN) {
        await selectXcodeDeveloperDirectoryAsync({ env, logger });
      }

      const sessionHost = await startDeviceSessionHostAsync(ctx, {
        runtimePlatform,
        env,
        logger,
        timeoutMs: STARTUP_TIMEOUT_MS,
        packageVersion,
        launchAppIdentifier: launch.launchAppIdentifier,
        launchArgs: launch.launchArgs,
        openUrl: launch.openUrl,
        networkCapture,
        networkCaptureFields,
      });

      try {
        const webPreview = await sessionHost.openPreviewAsync({ baseDomain: ngrokTunnelDomain });
        logger.info(`Preview URL: ${webPreview.previewPageUrl} (server: ${webPreview.apiUrl}).`);
        await uploadRemoteSessionConfigWithLocalEgressAsync({
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
              ? { webPreviewToken: webPreview.previewToken, previewToken: webPreview.previewToken }
              : {}),
          },
          logger,
        });

        await waitForDeviceRunSessionStoppedAsync({
          ctx,
          deviceRunSessionId,
          logger,
          maxDurationSeconds,
          signal,
        });
      } finally {
        await sessionHost.finishAsync();
      }
    }),
  });
}
