import { UserError, validateAndroidLaunchOptions } from '@expo/eas-build-job';
import {
  BuildFunction,
  BuildRuntimePlatform,
  BuildStepInput,
  BuildStepInputValueTypeName,
} from '@expo/steps';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { type CustomBuildContext } from '../../customBuildContext';
import {
  AndroidDeviceName,
  AndroidEmulatorUtils,
  AndroidVirtualDeviceName,
} from '../../utils/AndroidEmulatorUtils';
import { getDeviceRunSessionWorkerApi } from '../utils/deviceRunSessionWorkerApi';
import { readIosApplicationIdentifierAsync } from '../utils/iosAppArtifact';
import { resolveIosSessionStartupAsync } from '../utils/iosSimulatorSession';
import { runOnWarmIosSimulatorAsync } from '../utils/warmDeviceSessionHost';
import { type WarmIosSession } from '../utils/warmIosSession';
import { withLocalEgressSession } from '../utils/localEgressSession';
import {
  type ServeSimApplicationOptions,
  createCorsOriginsInputProvider,
  createFrameAncestorsInputProvider,
  createPrivatePreviewUrlInputProvider,
  createPublicPreviewInputProvider,
  createServeSimLaunchInputProviders,
  omitNgrokAuthtoken,
  parseCorsOriginsInput,
  parseFrameAncestorsInput,
  selectXcodeDeveloperDirectoryAsync,
  validateServeSimLaunchOptions,
} from '../utils/remoteDeviceRunSession';
import {
  createNetworkCaptureInputProviders,
  parseNetworkCaptureInputs,
} from '../utils/networkCaptureFields';
import { createStartupTasks } from '../utils/startupTasks';

import { downloadBuildAsync } from './downloadBuild';
import { installBuildAsync } from './installBuild';
import {
  launchApplicationAsync,
  parseLaunchArgsInput,
  parseOpenUrlInput,
} from './launchApplication';
import {
  getAgentDeviceRemoteSessionEnvOrThrow,
  runAgentDeviceRemoteSessionAsync,
} from './startAgentDeviceRemoteSession';
import { startAndroidEmulatorAsync } from './startAndroidEmulator';

const ANDROID_DEVICE_NAME = 'EasAndroidDevice01' as AndroidVirtualDeviceName;

/**
 * Starts a device session using an optional local app artifact, or one it downloads.
 * On iOS, serve-sim boots the selected Simulator, then installs and launches
 * the app. Build-tools verifies any egress guard before install and launch.
 */
export function createStartAgentDeviceSessionBuildFunction(
  ctx: CustomBuildContext,
  { warm = false }: { warm?: boolean } = {}
): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: warm ? 'start_warm_agent_device_session' : 'start_agent_device_session',
    name: 'Start agent-device session',
    __metricsId: warm ? 'eas/start_warm_agent_device_session' : 'eas/start_agent_device_session',
    inputProviders: [
      // Device. On iOS a Simulator name or UDID, on Android an AVD hardware profile.
      BuildStepInput.createProvider({
        id: 'device_identifier',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'system_image_package',
        required: false,
        defaultValue: AndroidEmulatorUtils.defaultSystemImagePackage,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'lcd_width',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.NUMBER,
      }),
      BuildStepInput.createProvider({
        id: 'lcd_height',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.NUMBER,
      }),
      BuildStepInput.createProvider({
        id: 'lcd_density',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.NUMBER,
      }),
      // Application. Pass at most one of install_app_path, build_id and application_archive_url.
      BuildStepInput.createProvider({
        id: 'install_app_path',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      // Deprecated: remove once workflows pass install_app_path.
      BuildStepInput.createProvider({
        id: 'build_id',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'application_archive_url',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      ...createServeSimLaunchInputProviders(),
      // Session.
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
    fn: withLocalEgressSession(async (stepsCtx, { inputs, env: stepEnv, signal }) => {
      const { logger, global } = stepsCtx;
      const { runtimePlatform } = global;
      const isIos = runtimePlatform === BuildRuntimePlatform.DARWIN;

      // Validate everything before any expensive work starts.
      const sessionEnv = getAgentDeviceRemoteSessionEnvOrThrow(stepEnv);
      const env = omitNgrokAuthtoken(stepEnv);
      const installAppPath = inputs.install_app_path.value as string | undefined;
      const buildId = inputs.build_id.value as string | undefined;
      const applicationArchiveUrl = inputs.application_archive_url.value as string | undefined;
      const launchAppIdentifier = inputs.launch_app_identifier.value as string | undefined;
      const launchArgs = parseLaunchArgsInput(inputs.launch_args.value);
      const openUrl =
        inputs.open_url.value === undefined ? undefined : parseOpenUrlInput(inputs.open_url.value);
      const download = buildId || applicationArchiveUrl;
      if ([installAppPath, buildId, applicationArchiveUrl].filter(Boolean).length > 1) {
        throw new UserError(
          'EAS_DOWNLOAD_BUILD_INVALID_SOURCE',
          'Pass only one of install_app_path, build_id or application_archive_url.'
        );
      }
      if (download && launchAppIdentifier !== undefined) {
        throw new UserError(
          'EAS_LAUNCH_APPLICATION_INVALID_INPUT',
          'launch_app_identifier cannot be combined with build_id or application_archive_url.'
        );
      }
      if (
        !installAppPath &&
        !download &&
        !launchAppIdentifier &&
        (launchArgs.length > 0 || openUrl)
      ) {
        throw new UserError(
          'EAS_LAUNCH_APPLICATION_INVALID_INPUT',
          'launch_args and open_url need an application: pass install_app_path or launch_app_identifier.'
        );
      }
      if (!isIos && launchAppIdentifier !== undefined) {
        throw new UserError(
          'EAS_LAUNCH_APPLICATION_INVALID_INPUT',
          'launch_app_identifier is only supported for iOS Simulator sessions. Pass install_app_path for Android.'
        );
      }
      if (isIos) {
        validateServeSimLaunchOptions({ launchArgs, openUrl });
      } else {
        validateAndroidLaunchOptions({ launchArgs, openUrl });
      }
      const deviceIdentifier = inputs.device_identifier.value as string | undefined;
      const capture = parseNetworkCaptureInputs(
        {
          networkCapture: inputs.network_capture.value,
          networkCaptureFields: inputs.network_capture_fields.value,
        },
        { runtimePlatform }
      );

      const startSessionAsync = async (warmSession?: WarmIosSession): Promise<void> => {
        const tasks = createStartupTasks(logger, signal);
        let downloaded: Promise<string> | undefined;
        let applicationReady: Promise<ServeSimApplicationOptions | void> | undefined;

        try {
          if (isIos) {
            // Select Xcode before serve-sim boots the device or any Simulator tools run.
            await selectXcodeDeveloperDirectoryAsync({ env, logger });
          }
          tasks.signal.throwIfAborted();
          const { launch, iosStartup } = isIos
            ? await resolveIosSessionStartupAsync({
                warm: warmSession !== undefined,
                runtimePlatform,
                bootSimulator: true,
                deviceIdentifier: warmSession?.device.udid ?? deviceIdentifier,
                installAppPath,
                launchAppIdentifier,
                // A downloaded app gets its launch options after the download.
                launchArgs: download ? [] : launchArgs,
                openUrl: download ? undefined : openUrl,
                env,
                logger,
                signal: tasks.signal,
              })
            : {};
          const iosSimulatorUdid = iosStartup?.iosSimulatorUdid;
          if (iosSimulatorUdid) {
            logger.info(`Selected iOS Simulator: ${iosSimulatorUdid}.`);
          }

          const booted = iosSimulatorUdid
            ? Promise.resolve()
            : tasks.run('Android Emulator boot', async taskLogger => {
                const logcatDirectory = await fs.promises.mkdtemp(
                  path.join(os.tmpdir(), 'eas-android-emulator-logcat-')
                );
                tasks.signal.throwIfAborted();
                await startAndroidEmulatorAsync({
                  deviceName: ANDROID_DEVICE_NAME,
                  systemImagePackage: `${inputs.system_image_package.value}`,
                  deviceIdentifier: deviceIdentifier as AndroidDeviceName | undefined,
                  lcdWidth: inputs.lcd_width.value as number | undefined,
                  lcdHeight: inputs.lcd_height.value as number | undefined,
                  lcdDensity: inputs.lcd_density.value as number | undefined,
                  logcatDirectory,
                  env,
                  logger: taskLogger,
                });
              });

          downloaded = download
            ? tasks.run('build download', async taskLogger => {
                const source = buildId
                  ? { buildId }
                  : applicationArchiveUrl
                    ? { applicationArchiveUrl }
                    : undefined;
                if (!source) {
                  throw new Error('No app source was provided for download.');
                }
                const { artifactPath } = await downloadBuildAsync({
                  logger: taskLogger,
                  ...source,
                  graphqlClient: ctx.graphqlClient,
                  deviceRunSessionWorkerApi: buildId ? getDeviceRunSessionWorkerApi(ctx) : null,
                  robotAccessToken: global.staticContext.job.secrets?.robotAccessToken ?? null,
                  extensions: isIos ? ['app'] : ['apk'],
                  signal: tasks.signal,
                });
                return artifactPath;
              })
            : undefined;
          const downloadedApp = downloaded;

          if (isIos && downloadedApp) {
            applicationReady = tasks.run('app preparation', async () => {
              const artifactPath = await downloadedApp;
              tasks.signal.throwIfAborted();
              const applicationIdentifier = await readIosApplicationIdentifierAsync({
                artifactPath,
                env,
              });
              tasks.signal.throwIfAborted();
              return {
                installAppPath: artifactPath,
                launchAppIdentifier: applicationIdentifier,
                launchArgs,
                openUrl,
              };
            });
          } else if (isIos && launch?.launchAppIdentifier) {
            applicationReady = Promise.resolve({
              ...launch,
              launchAppIdentifier: launch.launchAppIdentifier,
              installAppPath,
            });
          } else if (!isIos && (installAppPath || downloadedApp)) {
            applicationReady = tasks.run('app install and launch', async taskLogger => {
              await tasks.untilAborted(booted);
              const artifactPath = installAppPath ?? (await downloadedApp);
              if (!artifactPath) {
                throw new Error('No app artifact was prepared.');
              }
              tasks.signal.throwIfAborted();
              const { applicationIdentifier, activityName } = await installBuildAsync({
                artifactPath,
                runtimePlatform,
                env,
                logger: taskLogger,
              });
              tasks.signal.throwIfAborted();
              await launchApplicationAsync({
                applicationIdentifier,
                activityName,
                launchArgs,
                openUrl,
                runtimePlatform,
                env,
                logger: taskLogger,
              });
            });
          }

          await runAgentDeviceRemoteSessionAsync(ctx, {
            env,
            logger,
            signal,
            runtimePlatform,
            sessionEnv,
            packageVersion: inputs.package_version.value as string | undefined,
            // A missing or non-positive value disables the idle timeout (opt-in feature).
            maxIdleTimeMinutes: inputs.max_idle_time_minutes.value as number | undefined,
            maxDurationSeconds: inputs.max_duration_seconds.value as number | undefined,
            capture,
            disableShare: inputs.public_preview?.value === false,
            privatePreviewUrl: inputs.private_preview_url?.value as string | undefined,
            frameAncestors: parseFrameAncestorsInput(inputs.frame_ancestors?.value),
            corsOrigins: parseCorsOriginsInput(inputs.cors_origins?.value),
            tasks,
            warm: warmSession,
            device: iosSimulatorUdid
              ? {
                  iosSimulatorUdid,
                  bootEnv: iosStartup?.bootEnv,
                  application: applicationReady,
                }
              : {
                  booted,
                  ready: applicationReady ?? tasks.untilAborted(booted),
                },
          });
        } finally {
          tasks.abort(new Error('Agent-device session ended.'));
          await Promise.allSettled([downloaded, applicationReady]);
        }
      };
      // The warm path installs only a local app; build_id and application_archive_url start cold.
      if (warm && isIos && !download) {
        await runOnWarmIosSimulatorAsync(
          {
            engine: 'agent-device',
            requestedDevice: deviceIdentifier,
            packageVersion: inputs.package_version.value as string | undefined,
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
