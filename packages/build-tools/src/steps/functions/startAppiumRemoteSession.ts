import { SystemError } from '@expo/eas-build-job';
import { type bunyan } from '@expo/logger';
import { type Result, asyncResult } from '@expo/results';
import {
  BuildFunction,
  BuildRuntimePlatform,
  type BuildStepEnv,
  BuildStepInput,
  BuildStepInputValueTypeName,
} from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import semver from 'semver';
import { z } from 'zod';

import { type CustomBuildContext } from '../../customBuildContext';
import {
  uploadRemoteSessionConfigWithLocalEgressAsync,
  withLocalEgressSession,
} from '../utils/localEgressSession';
import { type DeviceSessionHost, startDeviceSessionHostAsync } from '../utils/deviceSessionHost';
import { resolveIosSessionStartupAsync } from './startIosSimulator';
import {
  createNetworkCaptureInputProviders,
  parseNetworkCaptureInputs,
} from '../utils/networkCaptureFields';
import { AndroidEmulatorUtils } from '../../utils/AndroidEmulatorUtils';
import { IosSimulatorUtils } from '../../utils/IosSimulatorUtils';
import {
  PackageManager,
  resolveConfiguredPackageManager,
  resolvePackageAdd,
} from '../../utils/packageManager';
import { sleepAsync } from '../../utils/retry';
import { turtleFetch } from '../../utils/turtleFetch';
import { startAppiumEventCollectionAsync } from '../utils/appiumEvents';
import {
  createIosSessionStartupInputProviders,
  createServeSimLaunchInputProviders,
  describeServeSimLaunch,
  ensureFfmpegInstalledOnceAsync,
  finishRemoteSessionAsync,
  getDeviceRunSessionIdOrThrow,
  getNgrokAuthtokenOrThrow,
  getNgrokTunnelDomainOrThrow,
  selectXcodeDeveloperDirectoryAsync,
  spawnDetached,
  startNgrokTunnelAsync,
  waitForDeviceRunSessionStoppedAsync,
} from '../utils/remoteDeviceRunSession';

const APPIUM_HOST = '127.0.0.1';
const APPIUM_PORT = 4723;
const APPIUM_STARTUP_TIMEOUT_MS = 120_000;
const DEFAULT_APPIUM_VERSION = '^3';

const AppiumInstalledDriversSchema = z.record(
  z.string(),
  z.object({ installed: z.boolean().optional() }).passthrough()
);

export function createStartAppiumRemoteSessionBuildFunction(
  ctx: CustomBuildContext
): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'start_appium_remote_session',
    name: 'Start Appium remote session',
    __metricsId: 'eas/start_appium_remote_session',
    inputProviders: [
      ...createServeSimLaunchInputProviders(),
      ...createIosSessionStartupInputProviders(),
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
    ],
    fn: withLocalEgressSession(async ({ logger, global }, { inputs, env, signal }) => {
      const deviceRunSessionId = getDeviceRunSessionIdOrThrow(env);
      const ngrokTunnelDomain = getNgrokTunnelDomainOrThrow(env);
      const ngrokAuthtoken = getNgrokAuthtokenOrThrow(env);
      const packageVersion = inputs.package_version.value as string | undefined;
      const maxIdleTimeMinutes = inputs.max_idle_time_minutes.value as number | undefined;
      const { runtimePlatform } = global;
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
        signal,
      });
      const { networkCapture, networkCaptureFields } = parseNetworkCaptureInputs(
        {
          networkCapture: inputs.network_capture?.value,
          networkCaptureFields: inputs.network_capture_fields?.value,
        },
        { runtimePlatform }
      );
      const versionSpec = resolveAppium3VersionSpec(packageVersion);

      logger.info(
        `Starting Appium remote session (version: ${versionSpec}, runtime: ${runtimePlatform}).`
      );
      const device: AppiumDevice = iosStartup
        ? {
            platformName: 'iOS',
            automationName: 'XCUITest',
            driverName: 'xcuitest',
            udid: iosStartup.iosSimulatorUdid,
          }
        : await resolveAppiumDeviceAsync({ runtimePlatform, env });
      const startupAbortController = new AbortController();
      const startupSignal = signal
        ? AbortSignal.any([signal, startupAbortController.signal])
        : startupAbortController.signal;
      let hostStartup: Promise<Result<DeviceSessionHost>> | undefined;
      let appiumProcess: ReturnType<typeof spawnDetached> | undefined;
      let appiumHome: string | undefined;
      let eventCollection: Awaited<ReturnType<typeof startAppiumEventCollectionAsync>> | undefined;
      let appiumTunnel: Awaited<ReturnType<typeof startNgrokTunnelAsync>> | undefined;
      let sessionFailed = false;
      const startHost = () =>
        startDeviceSessionHostAsync(ctx, {
          ...iosStartup,
          separateLogPhase: true,
          runtimePlatform,
          env,
          logger,
          timeoutMs: APPIUM_STARTUP_TIMEOUT_MS,
          signal: startupSignal,
          ...launch,
          networkCapture,
          networkCaptureFields,
        });
      try {
        if (iosStartup) {
          hostStartup = asyncResult(startHost());
        }
        // Appium's startRecordingScreen runs ffmpeg on this host: XCUITest encodes the
        // simulator stream with it, and UiAutomator2 merges long recordings with it. The
        // macOS session image does not ship ffmpeg, so install it concurrently with Appium.
        // Both installs settle before the step continues or fails, so no install outlives it.
        const [appiumInstall] = await Promise.all([
          asyncResult(
            installAppiumAsync({ versionSpec, driverName: device.driverName, env, logger })
          ),
          ensureFfmpegInstalledOnceAsync({ runtimePlatform, env, logger }),
        ]);
        const installation = appiumInstall.enforceValue();
        appiumHome = installation.appiumHome;
        const { appiumBinPath, appiumEnv } = installation;

        appiumProcess = spawnDetached({
          command: appiumBinPath,
          args: [
            '--address',
            APPIUM_HOST,
            '--port',
            String(APPIUM_PORT),
            '--base-path',
            '/',
            '--log-level',
            'error',
            // Appium 3 gates session listing (GET /appium/sessions) behind the
            // session_discovery insecure feature. We rely on it to poll for
            // Appium Event Timings, so enable it for all drivers.
            '--allow-insecure',
            '*:session_discovery',
            '--default-capabilities',
            JSON.stringify({ 'appium:eventTimings': true }),
          ],
          env: appiumEnv,
          logger,
        });
        await waitForAppiumReadyAsync({ appiumProcess, logger });
        eventCollection = await startAppiumEventCollectionAsync({
          ctx,
          deviceRunSessionId,
          appiumUrl: `http://${APPIUM_HOST}:${APPIUM_PORT}/`,
          logger,
        });
        appiumTunnel = await startNgrokTunnelAsync({
          port: APPIUM_PORT,
          subdomainPrefix: 'appium',
          baseDomain: ngrokTunnelDomain,
          authtoken: ngrokAuthtoken,
          logger,
        });

        // expo-device-hub has no serial-selection flag. Device run session workflows must expose
        // a single booted Android emulator so the Hub and Appium resolve the same device.
        const launchDescription = describeServeSimLaunch(launch);
        if (launchDescription) {
          logger.info(launchDescription);
        }
        const sessionHost = (await (hostStartup ??= asyncResult(startHost()))).enforceValue();
        const webPreview = await sessionHost.openPreviewAsync({ baseDomain: ngrokTunnelDomain });

        await uploadRemoteSessionConfigWithLocalEgressAsync({
          env,
          signal,
          ctx,
          deviceRunSessionId,
          remoteConfig: {
            appiumUrl: appiumTunnel.url,
            capabilities: {
              platformName: device.platformName,
              'appium:automationName': device.automationName,
              'appium:udid': device.udid,
            },
            webPreviewUrl: webPreview.previewPageUrl,
            previewApiUrl: webPreview.apiUrl,
            ...(webPreview.previewToken ? { webPreviewToken: webPreview.previewToken } : {}),
          },
          logger,
        });

        await waitForDeviceRunSessionStoppedAsync({
          ctx,
          deviceRunSessionId,
          logger,
          signal,
          idleTimeout:
            maxIdleTimeMinutes !== undefined && maxIdleTimeMinutes > 0
              ? {
                  maxIdleTimeMinutes,
                  getLastEventObservedAt: eventCollection.getLastEventObservedAt,
                }
              : undefined,
        });
      } catch (error) {
        sessionFailed = true;
        throw error;
      } finally {
        startupAbortController.abort(new Error('Appium session ended.'));
        await finishRemoteSessionAsync({
          logger,
          sessionFailed,
          teardown: [
            ['Appium tunnel', appiumTunnel?.stopAsync()],
            [
              'Appium server',
              (async () => {
                try {
                  await eventCollection?.stopAsync();
                } finally {
                  try {
                    await appiumProcess?.stopAsync();
                  } finally {
                    if (appiumHome) {
                      await fs.promises.rm(appiumHome, { recursive: true, force: true });
                    }
                  }
                }
              })(),
            ],
            ['session host', hostStartup?.then(result => result.value?.finishAsync())],
          ],
        });
      }
    }),
  });
}

export function resolveAppium3VersionSpec(packageVersion: string | undefined): string {
  const versionSpec = packageVersion ?? DEFAULT_APPIUM_VERSION;
  const range = semver.validRange(versionSpec);
  if (!range || !semver.subset(range, '>=3.0.0 <4.0.0-0')) {
    throw new SystemError(
      `Appium 3 is required for EAS Simulator sessions. Received package version "${versionSpec}".`
    );
  }
  return versionSpec;
}

export type AppiumDevice = {
  platformName: 'iOS' | 'Android';
  automationName: 'XCUITest' | 'UiAutomator2';
  driverName: 'xcuitest' | 'uiautomator2';
  udid: string;
};

export async function resolveAppiumDeviceAsync({
  runtimePlatform,
  env,
}: {
  runtimePlatform: BuildRuntimePlatform;
  env: BuildStepEnv;
}): Promise<AppiumDevice> {
  switch (runtimePlatform) {
    case BuildRuntimePlatform.DARWIN: {
      const [bootedDevice] = await IosSimulatorUtils.getAvailableDevicesAsync({
        env,
        filter: 'booted',
      });
      if (!bootedDevice) {
        throw new SystemError('Could not find a booted iOS simulator for the Appium session.');
      }
      return {
        platformName: 'iOS',
        automationName: 'XCUITest',
        driverName: 'xcuitest',
        udid: bootedDevice.udid,
      };
    }
    case BuildRuntimePlatform.LINUX: {
      const attachedDevices = await AndroidEmulatorUtils.getAttachedDevicesAsync({ env });
      const bootedDevice = attachedDevices.find(device => device.state === 'device');
      if (!bootedDevice) {
        throw new SystemError('Could not find a booted Android emulator for the Appium session.');
      }
      return {
        platformName: 'Android',
        automationName: 'UiAutomator2',
        driverName: 'uiautomator2',
        udid: bootedDevice.serialId,
      };
    }
  }
}

export async function installAppiumAsync({
  versionSpec,
  driverName,
  env,
  logger,
}: {
  versionSpec: string;
  driverName: AppiumDevice['driverName'];
  env: BuildStepEnv;
  logger: bunyan;
}): Promise<{ appiumHome: string; appiumBinPath: string; appiumEnv: BuildStepEnv }> {
  const appiumHome = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'eas-appium-home-'));
  await fs.promises.writeFile(
    path.join(appiumHome, 'package.json'),
    `${JSON.stringify({ name: 'eas-appium-home', private: true })}\n`
  );
  const appiumEnv: BuildStepEnv = { ...env, APPIUM_HOME: appiumHome };
  const appiumBinPath = path.join(appiumHome, 'node_modules', '.bin', 'appium');
  const add = resolvePackageAdd(
    resolveConfiguredPackageManager(env, PackageManager.NPM),
    `appium@${versionSpec}`
  );

  logger.info(`Installing appium@${versionSpec} with ${add.command}.`);
  await spawn(add.command, add.args, {
    cwd: appiumHome,
    env: appiumEnv,
    logger,
  });
  const { stdout } = await spawn(appiumBinPath, ['driver', 'list', '--installed', '--json'], {
    env: appiumEnv,
    stdio: 'pipe',
  });
  const installedDrivers = AppiumInstalledDriversSchema.parse(JSON.parse(stdout));
  if (installedDrivers[driverName]?.installed) {
    logger.info(`Updating the installed Appium ${driverName} driver.`);
    await spawn(appiumBinPath, ['driver', 'update', driverName], { env: appiumEnv, logger });
  } else {
    logger.info(`Installing the Appium ${driverName} driver.`);
    await spawn(appiumBinPath, ['driver', 'install', driverName], { env: appiumEnv, logger });
  }
  return { appiumHome, appiumBinPath, appiumEnv };
}

async function waitForAppiumReadyAsync({
  appiumProcess,
  logger,
}: {
  appiumProcess: { getOutput: () => string };
  logger: bunyan;
}): Promise<void> {
  const deadline = Date.now() + APPIUM_STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const response = await turtleFetch(`http://${APPIUM_HOST}:${APPIUM_PORT}/status`, 'GET', {
        timeout: 2_000,
        retries: 0,
        logger,
      });
      if (response.ok) {
        return;
      }
    } catch {}
    await sleepAsync(1_000);
  }
  const output = appiumProcess.getOutput();
  throw new SystemError(
    `Timed out waiting for Appium to become ready.${output ? `\nAppium output:\n${output}` : ''}`
  );
}
