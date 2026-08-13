import { SystemError } from '@expo/eas-build-job';
import { type bunyan } from '@expo/logger';
import {
  BuildFunction,
  BuildRuntimePlatform,
  type BuildStepEnv,
  BuildStepInput,
  BuildStepInputValueTypeName,
} from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import semver from 'semver';
import { z } from 'zod';

import { type CustomBuildContext } from '../../customBuildContext';
import { AndroidEmulatorUtils } from '../../utils/AndroidEmulatorUtils';
import { IosSimulatorUtils } from '../../utils/IosSimulatorUtils';
import { sleepAsync } from '../../utils/retry';
import { turtleFetch } from '../../utils/turtleFetch';
import { startAppiumEventCollectionAsync } from '../utils/appiumEvents';
import {
  getDeviceRunSessionIdOrThrow,
  getNgrokAuthtokenOrThrow,
  getNgrokTunnelDomainOrThrow,
  selectXcodeDeveloperDirectoryAsync,
  spawnDetached,
  startNgrokTunnelAsync,
  startServeSimWithTunnelAsync,
  uploadRemoteSessionConfigAsync,
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
    fn: async ({ logger, global }, { inputs, env, signal }) => {
      const deviceRunSessionId = getDeviceRunSessionIdOrThrow(env);
      const ngrokTunnelDomain = getNgrokTunnelDomainOrThrow(env);
      const ngrokAuthtoken = getNgrokAuthtokenOrThrow(env);
      const packageVersion = inputs.package_version.value as string | undefined;
      const maxIdleTimeMinutes = inputs.max_idle_time_minutes.value as number | undefined;
      const { runtimePlatform } = global;
      const versionSpec = resolveAppium3VersionSpec(packageVersion);

      logger.info(
        `Starting Appium remote session (version: ${versionSpec}, runtime: ${runtimePlatform}).`
      );
      const device = await resolveAppiumDeviceAsync({ runtimePlatform, env, logger });
      await installAppiumAsync({ versionSpec, driverName: device.driverName, env, logger });

      const appiumProcess = spawnDetached({
        command: 'appium',
        args: [
          '--address',
          APPIUM_HOST,
          '--port',
          String(APPIUM_PORT),
          '--base-path',
          '/',
          '--log-level',
          'error',
        ],
        env,
      });
      try {
        await waitForAppiumReadyAsync({ appiumProcess, logger });
      } catch (error) {
        await appiumProcess.stopAsync();
        throw error;
      }

      const eventCollection = await startAppiumEventCollectionAsync({
        ctx,
        deviceRunSessionId,
        appiumUrl: `http://${APPIUM_HOST}:${APPIUM_PORT}/`,
        logger,
      });
      let appiumTunnel: Awaited<ReturnType<typeof startNgrokTunnelAsync>> | undefined;
      let serveSim: Awaited<ReturnType<typeof startServeSimWithTunnelAsync>> | undefined;
      try {
        appiumTunnel = await startNgrokTunnelAsync({
          port: APPIUM_PORT,
          subdomainPrefix: 'appium',
          baseDomain: ngrokTunnelDomain,
          authtoken: ngrokAuthtoken,
          logger,
        });

        switch (runtimePlatform) {
          case BuildRuntimePlatform.DARWIN:
            serveSim = await startServeSimWithTunnelAsync(ctx, {
              baseDomain: ngrokTunnelDomain,
              env,
              logger,
              timeoutMs: APPIUM_STARTUP_TIMEOUT_MS,
            });
            break;
          case BuildRuntimePlatform.LINUX:
            break;
        }

        await uploadRemoteSessionConfigAsync({
          ctx,
          deviceRunSessionId,
          remoteConfig: {
            appiumUrl: appiumTunnel.url,
            capabilities: {
              platformName: device.platformName,
              'appium:automationName': device.automationName,
              'appium:udid': device.udid,
              'appium:eventTimings': true,
            },
            ...(serveSim ? { webPreviewUrl: serveSim.previewUrl } : {}),
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
      } finally {
        if (serveSim) {
          await serveSim.stopAsync();
        }
        if (appiumTunnel) {
          await appiumTunnel.stopAsync();
        }
        await eventCollection.stopAsync();
        await appiumProcess.stopAsync();
      }
    },
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

type AppiumDevice = {
  platformName: 'iOS' | 'Android';
  automationName: 'XCUITest' | 'UiAutomator2';
  driverName: 'xcuitest' | 'uiautomator2';
  udid: string;
};

export async function resolveAppiumDeviceAsync({
  runtimePlatform,
  env,
  logger,
}: {
  runtimePlatform: BuildRuntimePlatform;
  env: BuildStepEnv;
  logger: bunyan;
}): Promise<AppiumDevice> {
  switch (runtimePlatform) {
    case BuildRuntimePlatform.DARWIN: {
      await selectXcodeDeveloperDirectoryAsync({ env, logger });
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

async function installAppiumAsync({
  versionSpec,
  driverName,
  env,
  logger,
}: {
  versionSpec: string;
  driverName: AppiumDevice['driverName'];
  env: BuildStepEnv;
  logger: bunyan;
}): Promise<void> {
  logger.info(`Installing appium@${versionSpec}.`);
  await spawn('npm', ['install', '--global', `appium@${versionSpec}`], { env, logger });
  const { stdout } = await spawn('appium', ['driver', 'list', '--installed', '--json'], {
    env,
    stdio: 'pipe',
  });
  const installedDrivers = AppiumInstalledDriversSchema.parse(JSON.parse(stdout));
  if (installedDrivers[driverName]?.installed) {
    logger.info(`Updating the installed Appium ${driverName} driver.`);
    await spawn('appium', ['driver', 'update', driverName], { env, logger });
  } else {
    logger.info(`Installing the Appium ${driverName} driver.`);
    await spawn('appium', ['driver', 'install', driverName], { env, logger });
  }
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
