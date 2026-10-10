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
import { withLocalEgressSession } from '../utils/localEgressSession';
import { selectXcodeDeveloperDirectoryAsync } from '../utils/remoteDeviceRunSession';
import {
  createNetworkCaptureInputProviders,
  parseNetworkCaptureInputs,
} from '../utils/networkCaptureFields';
import { createStartupTasks } from '../utils/startupTasks';
import {
  type ServeSimApplicationOptions,
  validateServeSimLaunchOptions,
} from '../utils/remoteDeviceRunSession';

import { downloadBuildAsync } from './downloadBuild';
import { installBuildAsync, readIosApplicationIdentifierAsync } from './installBuild';
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
import { resolveIosSessionStartupAsync } from './startIosSimulator';

const ANDROID_DEVICE_NAME = 'EasAndroidDevice01' as AndroidVirtualDeviceName;

/**
 * Starts a device session, downloading the app alongside daemon startup.
 * On iOS, serve-sim boots the selected Simulator, then installs and launches
 * the downloaded app. Build-tools verifies any egress guard before install and launch.
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
      ...createNetworkCaptureInputProviders(),
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
      if (isIos) {
        validateServeSimLaunchOptions({ launchArgs, openUrl });
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
      let downloaded: Promise<string> | undefined;
      let applicationReady: Promise<ServeSimApplicationOptions | void> | undefined;

      try {
        if (isIos) {
          // Select Xcode before serve-sim boots the device or any Simulator tools run.
          await selectXcodeDeveloperDirectoryAsync({ env, logger });
        }
        tasks.signal.throwIfAborted();
        const { iosStartup } = isIos
          ? await resolveIosSessionStartupAsync({
              runtimePlatform,
              bootSimulator: true,
              deviceIdentifier,
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

        downloaded = hasApplication
          ? tasks.run('build download', async taskLogger => {
              const { artifactPath } = await downloadBuildAsync({
                logger: taskLogger,
                ...(buildId ? { buildId } : { applicationArchiveUrl: applicationArchiveUrl! }),
                graphqlClient: ctx.graphqlClient,
                robotAccessToken: global.staticContext.job.secrets?.robotAccessToken ?? null,
                extensions: isIos ? ['app'] : ['apk'],
                signal: tasks.signal,
              });
              return artifactPath;
            })
          : undefined;

        const download = downloaded;
        applicationReady = download
          ? tasks.run(isIos ? 'app preparation' : 'app install and launch', async taskLogger => {
              if (booted) {
                await tasks.untilAborted(booted);
              }
              const artifactPath = await download;
              tasks.signal.throwIfAborted();
              if (isIos) {
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
              }
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
            })
          : undefined;

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
          tasks,
          device: iosSimulatorUdid
            ? {
                ...iosStartup,
                iosSimulatorUdid,
                application: applicationReady,
              }
            : {
                booted: booted!,
                ready: applicationReady ?? tasks.untilAborted(booted!),
              },
        });
      } finally {
        tasks.abort(new Error('Agent-device session ended.'));
        await Promise.allSettled([downloaded, applicationReady]);
      }
    }),
  });
}
