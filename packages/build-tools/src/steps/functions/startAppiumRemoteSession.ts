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
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
  startDeviceWebPreviewWithTunnelAsync,
  startNgrokTunnelAsync,
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
      const { appiumHome, appiumBinPath, appiumEnv } = await installAppiumAsync({
        versionSpec,
        driverName: device.driverName,
        env,
        logger,
      });

      const appiumProcess = spawnDetached({
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
      });
      try {
        await waitForAppiumReadyAsync({ appiumProcess, logger });
      } catch (error) {
        await appiumProcess.stopAsync();
        await fs.promises.rm(appiumHome, { recursive: true, force: true });
        throw error;
      }

      const eventCollection = await startAppiumEventCollectionAsync({
        ctx,
        deviceRunSessionId,
        appiumUrl: `http://${APPIUM_HOST}:${APPIUM_PORT}/`,
        logger,
      });
      let appiumTunnel: Awaited<ReturnType<typeof startNgrokTunnelAsync>> | undefined;
      let webPreview: Awaited<ReturnType<typeof startDeviceWebPreviewWithTunnelAsync>> | undefined;
      try {
        appiumTunnel = await startNgrokTunnelAsync({
          port: APPIUM_PORT,
          subdomainPrefix: 'appium',
          baseDomain: ngrokTunnelDomain,
          authtoken: ngrokAuthtoken,
          logger,
        });

        webPreview = await startDeviceWebPreviewWithTunnelAsync(ctx, {
          runtimePlatform,
          baseDomain: ngrokTunnelDomain,
          env,
          logger,
          timeoutMs: APPIUM_STARTUP_TIMEOUT_MS,
          serial: runtimePlatform === BuildRuntimePlatform.LINUX ? device.udid : undefined,
        });

        await uploadRemoteSessionConfigAsync({
          ctx,
          deviceRunSessionId,
          remoteConfig: {
            appiumUrl: appiumTunnel.url,
            capabilities: {
              platformName: device.platformName,
              'appium:automationName': device.automationName,
              'appium:udid': device.udid,
            },
            webPreviewUrl: webPreview.previewUrl,
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
        if (webPreview) {
          await webPreview.stopAsync();
        }
        if (appiumTunnel) {
          await appiumTunnel.stopAsync();
        }
        await eventCollection.stopAsync();
        await appiumProcess.stopAsync();
        await fs.promises.rm(appiumHome, { recursive: true, force: true });
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
}): Promise<{ appiumHome: string; appiumBinPath: string; appiumEnv: BuildStepEnv }> {
  const appiumHome = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'eas-appium-home-'));
  await fs.promises.writeFile(
    path.join(appiumHome, 'package.json'),
    `${JSON.stringify({ name: 'eas-appium-home', private: true })}\n`
  );
  const appiumEnv: BuildStepEnv = { ...env, APPIUM_HOME: appiumHome };
  const appiumBinPath = path.join(appiumHome, 'node_modules', '.bin', 'appium');

  logger.info(`Installing appium@${versionSpec}.`);
  await spawn('npm', ['install', '--prefix', appiumHome, `appium@${versionSpec}`], {
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
