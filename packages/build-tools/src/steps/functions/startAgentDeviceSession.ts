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
import { withLocalEgressSession } from '../utils/localEgressSession';
import {
  createCorsOriginsInputProvider,
  createFrameAncestorsInputProvider,
  createPrivatePreviewUrlInputProvider,
  createPublicPreviewInputProvider,
  createServeSimLaunchInputProviders,
  omitNgrokAuthtoken,
  parseCorsOriginsInput,
  parseFrameAncestorsInput,
  selectXcodeDeveloperDirectoryAsync,
} from '../utils/remoteDeviceRunSession';
import {
  createNetworkCaptureInputProviders,
  parseNetworkCaptureInputs,
} from '../utils/networkCaptureFields';
import { createStartupTasks } from '../utils/startupTasks';
import {
  type ServeSimApplicationOptions,
  validateServeSimLaunchOptions,
} from '../utils/remoteDeviceRunSession';

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
import { resolveIosSessionStartupAsync } from '../utils/iosSimulatorSession';

const ANDROID_DEVICE_NAME = 'EasAndroidDevice01' as AndroidVirtualDeviceName;

/**
 * Starts a device session using an optional local app artifact.
 * On iOS, serve-sim boots the selected Simulator, then installs and launches
 * the supplied app. Build-tools verifies any egress guard before install and launch.
 */
export function createStartAgentDeviceSessionBuildFunction(ctx: CustomBuildContext): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'start_agent_device_session',
    name: 'Start agent-device session',
    __metricsId: 'eas/start_agent_device_session',
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
      BuildStepInput.createProvider({
        id: 'install_app_path',
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
      const launchAppIdentifier = inputs.launch_app_identifier.value as string | undefined;
      const launchArgs = parseLaunchArgsInput(inputs.launch_args.value);
      const openUrl =
        inputs.open_url.value === undefined ? undefined : parseOpenUrlInput(inputs.open_url.value);
      if (!installAppPath && !launchAppIdentifier && (launchArgs.length > 0 || openUrl)) {
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

      const tasks = createStartupTasks(logger, signal);
      let applicationReady: Promise<ServeSimApplicationOptions | void> | undefined;

      try {
        if (isIos) {
          // Select Xcode before serve-sim boots the device or any Simulator tools run.
          await selectXcodeDeveloperDirectoryAsync({ env, logger });
        }
        tasks.signal.throwIfAborted();
        const { launch, iosStartup } = isIos
          ? await resolveIosSessionStartupAsync({
              runtimePlatform,
              bootSimulator: true,
              deviceIdentifier,
              installAppPath,
              launchAppIdentifier,
              launchArgs,
              openUrl,
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
          ? undefined
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

        if (isIos && launch?.launchAppIdentifier) {
          applicationReady = Promise.resolve({
            ...launch,
            launchAppIdentifier: launch.launchAppIdentifier,
            installAppPath,
          });
        } else if (!isIos && installAppPath) {
          applicationReady = tasks.run('app install and launch', async taskLogger => {
            await tasks.untilAborted(booted!);
            const { applicationIdentifier, activityName } = await installBuildAsync({
              artifactPath: installAppPath,
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
          device: iosSimulatorUdid
            ? {
                iosSimulatorUdid,
                bootEnv: iosStartup?.bootEnv,
                application: applicationReady,
              }
            : {
                booted: booted!,
                ready: applicationReady ?? tasks.untilAborted(booted!),
              },
        });
      } finally {
        tasks.abort(new Error('Agent-device session ended.'));
        await Promise.allSettled([applicationReady]);
      }
    }),
  });
}
