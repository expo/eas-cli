import {
  BuildFunction,
  BuildRuntimePlatform,
  BuildStepInput,
  BuildStepInputValueTypeName,
} from '@expo/steps';

import { CustomBuildContext } from '../../customBuildContext';
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
  startDeviceWebPreviewWithTunnelAsync,
  waitForDeviceRunSessionStoppedAsync,
} from '../utils/remoteDeviceRunSession';
import { parseNetworkCaptureInputs } from '../utils/networkCaptureFields';

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
      BuildStepInput.createProvider({
        id: 'package_version',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'network_capture',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.BOOLEAN,
      }),
      BuildStepInput.createProvider({
        id: 'network_capture_fields',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.JSON,
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
      const { networkCapture, networkCaptureFields } = parseNetworkCaptureInputs(
        {
          networkCapture: inputs.network_capture?.value,
          networkCaptureFields: inputs.network_capture_fields?.value,
        },
        { runtimePlatform: global.runtimePlatform }
      );
      const { runtimePlatform } = global;
      const launch = parseServeSimLaunchInputs(
        {
          launchAppIdentifier: inputs.launch_app_identifier?.value as string | undefined,
          launchArgs: inputs.launch_args?.value,
          openUrl: inputs.open_url?.value as string | undefined,
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

      const webPreview = await startDeviceWebPreviewWithTunnelAsync(ctx, {
        runtimePlatform,
        baseDomain: ngrokTunnelDomain,
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
      logger.info(`Preview URL: ${webPreview.previewPageUrl} (server: ${webPreview.apiUrl}).`);

      try {
        await uploadRemoteSessionConfigWithLocalEgressAsync({
          env,
          signal,
          ctx,
          deviceRunSessionId,
          remoteConfig: {
            previewUrl: webPreview.previewPageUrl,
            previewApiUrl: webPreview.apiUrl,
            ...(webPreview.previewToken ? { previewToken: webPreview.previewToken } : {}),
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
        await webPreview.stopAsync();
      }
    }),
  });
}
