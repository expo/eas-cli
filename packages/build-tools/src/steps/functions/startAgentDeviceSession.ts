import { UserError } from '@expo/eas-build-job';
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
import { IosSimulatorName, IosSimulatorUuid } from '../../utils/IosSimulatorUtils';
import { withLocalEgressSession } from '../utils/localEgressSession';
import {
  ensureFfmpegInstalledOnceAsync,
  parseServeSimLaunchInputs,
  selectXcodeDeveloperDirectoryAsync,
} from '../utils/remoteDeviceRunSession';
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
import { bootIosSimulatorAsync } from './startIosSimulator';

const ANDROID_DEVICE_NAME = 'EasAndroidDevice01' as AndroidVirtualDeviceName;

/**
 * One step for a whole agent-device session: boot the device, download, install and
 * launch the app, and start the agent-device daemon and the web preview.
 *
 * It replaces eas/start_ios_simulator or eas/start_android_emulator, eas/download_build,
 * eas/install_build, eas/launch_application and eas/start_agent_device_remote_session,
 * so the parts that do not depend on each other can run at the same time:
 *
 *   boot ─────────────┬─► install ─► launch ─┐
 *   download ─────────┘                      │
 *   boot ─► session host ─► web preview ─────┼─► ready
 *   agent-device daemon ─► tunnel ───────────┘
 *   ffmpeg (Android) ─► (session host waits for it)
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
      // Application. Pass at most one of build_id and application_archive_url.
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
      BuildStepInput.createProvider({
        id: 'launch_args',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.JSON,
      }),
      BuildStepInput.createProvider({
        id: 'open_url',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      // Session.
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
    fn: withLocalEgressSession(async (stepsCtx, { inputs, env, signal }) => {
      const { logger, global } = stepsCtx;
      const { runtimePlatform } = global;
      const isIos = runtimePlatform === BuildRuntimePlatform.DARWIN;

      // Validate everything before any expensive work starts.
      const sessionEnv = getAgentDeviceRemoteSessionEnvOrThrow(env);
      const buildId = inputs.build_id.value as string | undefined;
      const applicationArchiveUrl = inputs.application_archive_url.value as string | undefined;
      if (buildId && applicationArchiveUrl) {
        throw new UserError(
          'EAS_DOWNLOAD_BUILD_INVALID_SOURCE',
          'Pass only one of build_id or application_archive_url.'
        );
      }
      const hasApplication = Boolean(buildId || applicationArchiveUrl);
      const launchArgs = parseLaunchArgsInput(inputs.launch_args.value);
      const openUrl =
        inputs.open_url.value === undefined ? undefined : parseOpenUrlInput(inputs.open_url.value);
      if (!hasApplication && (launchArgs.length > 0 || openUrl)) {
        throw new UserError(
          'EAS_LAUNCH_APPLICATION_INVALID_INPUT',
          'launch_args and open_url need an application: pass build_id or application_archive_url.'
        );
      }
      const deviceIdentifier = inputs.device_identifier.value as string | undefined;

      if (isIos) {
        // Before the boot, so every Xcode tool below uses the same developer directory.
        await selectXcodeDeveloperDirectoryAsync({ env, logger });
      }

      const tasks = createStartupTasks(logger);

      if (!isIos) {
        // expo-device-hub needs ffmpeg, and the Android image does not ship it. The
        // session host waits for this same install. It never rejects.
        void ensureFfmpegInstalledOnceAsync({ runtimePlatform, env, logger });
      }

      const booted = tasks.run(isIos ? 'iOS Simulator boot' : 'Android Emulator boot', async () => {
        if (isIos) {
          await bootIosSimulatorAsync({
            deviceIdentifier: deviceIdentifier as IosSimulatorUuid | IosSimulatorName | undefined,
            env,
            logger,
          });
          return;
        }
        await startAndroidEmulatorAsync({
          deviceName: ANDROID_DEVICE_NAME,
          systemImagePackage: `${inputs.system_image_package.value}`,
          deviceIdentifier: deviceIdentifier as AndroidDeviceName | undefined,
          lcdWidth: inputs.lcd_width.value as number | undefined,
          lcdHeight: inputs.lcd_height.value as number | undefined,
          lcdDensity: inputs.lcd_density.value as number | undefined,
          logcatDirectory: await fs.promises.mkdtemp(
            path.join(os.tmpdir(), 'eas-android-emulator-logcat-')
          ),
          env,
          logger,
        });
      });

      const downloaded = hasApplication
        ? tasks.run('build download', async () => {
            const { artifactPath } = await downloadBuildAsync({
              logger,
              ...(buildId ? { buildId } : { applicationArchiveUrl: applicationArchiveUrl! }),
              graphqlClient: ctx.graphqlClient,
              robotAccessToken: global.staticContext.job.secrets?.robotAccessToken ?? null,
              extensions: isIos ? ['app'] : ['apk'],
            });
            return artifactPath;
          })
        : undefined;

      const ready = downloaded
        ? tasks.run('app install and launch', async () => {
            const [artifactPath] = await Promise.all([downloaded, booted]);
            const { applicationIdentifier, activityName } = await installBuildAsync({
              artifactPath,
              runtimePlatform,
              env,
              logger,
            });
            await launchApplicationAsync({
              applicationIdentifier,
              activityName,
              launchArgs,
              openUrl,
              runtimePlatform,
              env,
              logger,
            });
          })
        : booted;

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
        // The app is launched with simctl / adb above, not by serve-sim.
        launch: parseServeSimLaunchInputs({}, { runtimePlatform }),
        tasks,
        device: { booted, ready },
      });
    }),
  });
}
