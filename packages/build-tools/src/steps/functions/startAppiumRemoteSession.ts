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
import spawn, { type SpawnOptions, type SpawnResult } from '@expo/turtle-spawn';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as setTimeoutAsync } from 'node:timers/promises';
import semver from 'semver';
import { z } from 'zod';

import { type CustomBuildContext } from '../../customBuildContext';
import {
  uploadRemoteSessionConfigWithLocalEgressAsync,
  withLocalEgressSession,
} from '../utils/localEgressSession';
import { type DeviceSessionHost, startDeviceSessionHostAsync } from '../utils/deviceSessionHost';
import {
  WarmSessionAdoptionError,
  createWarmDeviceSessionServer,
  runOnWarmIosSimulatorAsync,
} from '../utils/warmDeviceSessionHost';
import { type WarmIosSession } from '../utils/warmIosSession';
import { resolveIosSessionStartupAsync } from '../utils/iosSimulatorSession';
import {
  createNetworkCaptureInputProviders,
  parseNetworkCaptureInputs,
} from '../utils/networkCaptureFields';
import { AndroidEmulatorUtils } from '../../utils/AndroidEmulatorUtils';
import { IosSimulatorUtils, type IosSimulatorUuid } from '../../utils/IosSimulatorUtils';
import {
  PackageManager,
  resolveConfiguredPackageManager,
  resolvePackageAdd,
} from '../../utils/packageManager';
import { killProcessGroup } from '../../utils/processes';
import { sleepAsync } from '../../utils/retry';
import { turtleFetch } from '../../utils/turtleFetch';
import { startAppiumEventCollectionAsync } from '../utils/appiumEvents';
import { preparePreinstalledWdaAsync } from '../utils/preinstalledWda';
import {
  createCorsOriginsInputProvider,
  createFrameAncestorsInputProvider,
  createIosSessionStartupInputProviders,
  createPrivatePreviewUrlInputProvider,
  createPublicPreviewInputProvider,
  createServeSimLaunchInputProviders,
  describeServeSimLaunch,
  ensureFfmpegInstalledOnceAsync,
  finishRemoteSessionAsync,
  getDeviceRunSessionIdOrThrow,
  getNgrokAuthtokenOrThrow,
  getNgrokTunnelDomainOrThrow,
  omitNgrokAuthtoken,
  parseCorsOriginsInput,
  parseFrameAncestorsInput,
  selectXcodeDeveloperDirectoryAsync,
  spawnDetached,
  startNgrokTunnelAsync,
  waitForDeviceRunSessionStoppedAsync,
} from '../utils/remoteDeviceRunSession';

const APPIUM_HOST = '127.0.0.1';
const APPIUM_PORT = 4723;
const APPIUM_STARTUP_TIMEOUT_MS = 120_000;
const DEFAULT_APPIUM_VERSION = '^3';
const FDA_HELPER = '/usr/local/libexec/turtle-tcc-fda';

const AppiumInstalledDriversSchema = z.record(
  z.string(),
  z.object({ installed: z.boolean().optional() }).passthrough()
);

export function createStartAppiumRemoteSessionBuildFunction(
  ctx: CustomBuildContext,
  { warm = false }: { warm?: boolean } = {}
): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: warm ? 'start_warm_appium_remote_session' : 'start_appium_remote_session',
    name: 'Start Appium remote session',
    __metricsId: warm ? 'eas/start_warm_appium_remote_session' : 'eas/start_appium_remote_session',
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
        id: 'max_idle_time_minutes',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.NUMBER,
      }),
    ],
    fn: withLocalEgressSession(async ({ logger, global }, { inputs, env: stepEnv, signal }) => {
      const deviceRunSessionId = getDeviceRunSessionIdOrThrow(stepEnv);
      const ngrokTunnelDomain = getNgrokTunnelDomainOrThrow(stepEnv);
      const ngrokAuthtoken = getNgrokAuthtokenOrThrow(stepEnv);
      const env = omitNgrokAuthtoken(stepEnv);
      const packageVersion = inputs.package_version.value as string | undefined;
      const maxIdleTimeMinutes = inputs.max_idle_time_minutes.value as number | undefined;
      const { runtimePlatform } = global;
      if (runtimePlatform === BuildRuntimePlatform.DARWIN) {
        await selectXcodeDeveloperDirectoryAsync({ env, logger });
      }
      const deviceIdentifier = inputs.device_identifier?.value as string | undefined;
      const startSessionAsync = async (warmSession?: WarmIosSession): Promise<void> => {
        const { launch, iosStartup } = await resolveIosSessionStartupAsync({
          warm: warmSession !== undefined,
          runtimePlatform,
          bootSimulator: inputs.boot_simulator?.value as boolean | undefined,
          deviceIdentifier: warmSession?.device.udid ?? deviceIdentifier,
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
        const setupSignal = iosStartup ? startupSignal : undefined;
        let hostStartup: Promise<Result<DeviceSessionHost>> | undefined;
        let sessionHost: DeviceSessionHost | undefined;
        let appiumProcess: ReturnType<typeof spawnDetached> | undefined;
        let appiumHome: string | undefined;
        let eventCollection:
          | Awaited<ReturnType<typeof startAppiumEventCollectionAsync>>
          | undefined;
        let appiumTunnel: Awaited<ReturnType<typeof startNgrokTunnelAsync>> | undefined;
        let sessionFailed = false;
        let sessionError: unknown;
        const startHost = () =>
          startDeviceSessionHostAsync(
            ctx,
            {
              ...iosStartup,
              separateLogPhase: true,
              runtimePlatform,
              env,
              logger,
              timeoutMs: APPIUM_STARTUP_TIMEOUT_MS,
              preview: { baseDomain: ngrokTunnelDomain, authtoken: ngrokAuthtoken },
              disableShare: inputs.public_preview?.value === false,
              privatePreviewUrl: inputs.private_preview_url?.value as string | undefined,
              frameAncestors: parseFrameAncestorsInput(inputs.frame_ancestors?.value),
              corsOrigins: parseCorsOriginsInput(inputs.cors_origins?.value),
              signal: startupSignal,
              onStartupError: iosStartup ? error => startupAbortController.abort(error) : undefined,
              ...launch,
              networkCapture,
              networkCaptureFields,
            },
            ...(warmSession ? [createWarmDeviceSessionServer(ctx, logger, warmSession)] : [])
          ).catch(error => {
            if (iosStartup) {
              startupAbortController.abort(error);
            }
            throw error;
          });
        try {
          if (iosStartup) {
            hostStartup = asyncResult(startHost());
          }
          // Appium's startRecordingScreen runs ffmpeg on this host: XCUITest encodes the
          // simulator stream with it, and UiAutomator2 merges long recordings with it. The
          // macOS session image does not ship ffmpeg, so install it concurrently with Appium.
          // Both owned installs settle before proceeding; a shared FFmpeg install keeps its owner.
          const [appiumInstall] = await Promise.all([
            asyncResult(
              installAppiumAsync({
                versionSpec,
                driverName: device.driverName,
                env,
                logger,
                signal: setupSignal,
                onError: iosStartup ? error => startupAbortController.abort(error) : undefined,
              }).catch(error => {
                if (iosStartup) {
                  startupAbortController.abort(error);
                }
                throw error;
              })
            ),
            asyncResult(
              ensureFfmpegInstalledOnceAsync({ runtimePlatform, env, logger, signal: setupSignal })
            ),
          ]);
          const installation = appiumInstall.enforceValue();
          appiumHome = installation.appiumHome;
          setupSignal?.throwIfAborted();
          const { appiumBinPath, appiumEnv } = installation;
          const wdaCapabilities = await preparePreinstalledWdaAsync({
            runtimeIdentifier: iosStartup
              ? (
                  await IosSimulatorUtils.getDeviceAsync({
                    udid: iosStartup.iosSimulatorUdid as IosSimulatorUuid,
                    env,
                  })
                )?.runtime
              : device.runtimeIdentifier,
            appiumHome,
            appiumBinPath,
            appiumEnv,
            logger,
            signal: setupSignal,
          });

          setupSignal?.throwIfAborted();
          const useFdaHelper =
            runtimePlatform === BuildRuntimePlatform.DARWIN && fs.existsSync(FDA_HELPER);
          appiumProcess = spawnDetached({
            command: useFdaHelper ? FDA_HELPER : appiumBinPath,
            args: [
              ...(useFdaHelper ? [appiumBinPath] : []),
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
              JSON.stringify({
                'appium:eventTimings': true,
                // Without it, XCUITest restarted the booted Simulator at session start, which
                // closed the app serve-sim had launched. EAS VMs never show the Simulator window.
                ...(device.platformName === 'iOS' ? { 'appium:isHeadless': true } : {}),
                ...wdaCapabilities,
              }),
            ],
            env: appiumEnv,
            logger,
          });
          await waitForAppiumReadyAsync({ appiumProcess, logger, signal: setupSignal });
          if (hostStartup) {
            sessionHost = (await hostStartup).enforceValue();
          }
          setupSignal?.throwIfAborted();
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
          sessionHost ??= (await (hostStartup ??= asyncResult(startHost()))).enforceValue();
          const webPreview = await sessionHost.openPreviewAsync();

          const sessionStart = await uploadRemoteSessionConfigWithLocalEgressAsync({
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
          if (sessionStart === 'stopped') {
            return;
          }

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
                    getLastPreviewActivityAt: () => sessionHost?.getLastPreviewActivityAt(),
                  }
                : undefined,
          });
        } catch (error) {
          sessionFailed = true;
          sessionError = setupSignal?.aborted ? setupSignal.reason : error;
          throw sessionError;
        } finally {
          startupAbortController.abort(new Error('Appium session ended.'));
          const appiumStopErrors: unknown[] = [];
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
                    } catch (error) {
                      appiumStopErrors.push(error);
                      throw error;
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
          if (sessionError instanceof WarmSessionAdoptionError && appiumStopErrors.length) {
            throw new AggregateError(
              [sessionError, ...appiumStopErrors],
              'Could not stop Appium after warm adoption failed; a cold session cannot start safely.'
            );
          }
        }
      };
      if (warm && runtimePlatform === BuildRuntimePlatform.DARWIN) {
        await runOnWarmIosSimulatorAsync(
          // package_version is the Appium version, which the job installs either way.
          { engine: 'appium', requestedDevice: deviceIdentifier, env, logger, signal },
          startSessionAsync
        );
      } else {
        await startSessionAsync();
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
  runtimeIdentifier?: string;
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
        runtimeIdentifier: bootedDevice.runtime,
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
  signal,
  onError,
}: {
  versionSpec: string;
  driverName: AppiumDevice['driverName'];
  env: BuildStepEnv;
  logger: bunyan;
  signal?: AbortSignal;
  onError?: (error: unknown) => void;
}): Promise<{ appiumHome: string; appiumBinPath: string; appiumEnv: BuildStepEnv }> {
  signal?.throwIfAborted();
  const appiumHome = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'eas-appium-home-'));
  try {
    signal?.throwIfAborted();
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
    await runAppiumSetupCommandAsync(
      add.command,
      add.args,
      {
        cwd: appiumHome,
        env: appiumEnv,
        logger,
      },
      signal
    );
    const { stdout } = await runAppiumSetupCommandAsync(
      appiumBinPath,
      ['driver', 'list', '--installed', '--json'],
      {
        env: appiumEnv,
        stdio: 'pipe',
      },
      signal
    );
    const installedDrivers = AppiumInstalledDriversSchema.parse(JSON.parse(stdout));
    if (installedDrivers[driverName]?.installed) {
      logger.info(`Updating the installed Appium ${driverName} driver.`);
      await runAppiumSetupCommandAsync(
        appiumBinPath,
        ['driver', 'update', driverName],
        { env: appiumEnv, logger },
        signal
      );
    } else {
      logger.info(`Installing the Appium ${driverName} driver.`);
      await runAppiumSetupCommandAsync(
        appiumBinPath,
        ['driver', 'install', driverName],
        { env: appiumEnv, logger },
        signal
      );
    }
    return { appiumHome, appiumBinPath, appiumEnv };
  } catch (error) {
    onError?.(error);
    if (signal) {
      await fs.promises.rm(appiumHome, { recursive: true, force: true });
      signal.throwIfAborted();
    }
    throw error;
  }
}

async function runAppiumSetupCommandAsync(
  command: string,
  args: string[],
  options: SpawnOptions,
  signal?: AbortSignal
): Promise<SpawnResult> {
  if (!signal) {
    return await spawn(command, args, options);
  }
  signal.throwIfAborted();
  const task = spawn(command, args, { ...options, detached: true });
  const abort = (): void => killProcessGroup(task.child, 'SIGKILL');
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) {
    abort();
  }
  try {
    const result = await task;
    signal.throwIfAborted();
    return result;
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

async function waitForAppiumReadyAsync({
  appiumProcess,
  logger,
  signal,
}: {
  appiumProcess: { getOutput: () => string };
  logger: bunyan;
  signal?: AbortSignal;
}): Promise<void> {
  const deadline = Date.now() + APPIUM_STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    try {
      const response = await turtleFetch(`http://${APPIUM_HOST}:${APPIUM_PORT}/status`, 'GET', {
        timeout: 2_000,
        retries: 0,
        logger,
        signal,
      });
      signal?.throwIfAborted();
      if (response.ok) {
        return;
      }
    } catch {}
    signal?.throwIfAborted();
    if (signal) {
      await setTimeoutAsync(1_000, undefined, { signal });
    } else {
      await sleepAsync(1_000);
    }
  }
  const output = appiumProcess.getOutput();
  throw new SystemError(
    `Timed out waiting for Appium to become ready.${output ? `\nAppium output:\n${output}` : ''}`
  );
}
