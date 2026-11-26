import { UserError } from '@expo/eas-build-job';
import { type bunyan } from '@expo/logger';
import { asyncResult } from '@expo/results';
import {
  BuildFunction,
  BuildRuntimePlatform,
  type BuildStepEnv,
  BuildStepInput,
  BuildStepInputValueTypeName,
  BuildStepOutput,
} from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  AndroidDeviceName,
  AndroidDeviceSerialId,
  AndroidEmulatorExitedError,
  AndroidEmulatorUtils,
  AndroidVirtualDeviceName,
} from '../../utils/AndroidEmulatorUtils';
import { type AndroidEmulatorLogCapture } from '../../utils/androidEmulatorLogCapture';
import { retryAsync } from '../../utils/retry';
import { resolveAndroidEmulatorLocalEgressAsync } from '../utils/androidLocalEgress';
import { ALL_ANDROID_EMULATOR_LOG_SOURCES } from '../../utils/androidEmulatorLogSources';
import { getAndroidEmulatorLogCapture } from '../utils/androidEmulatorLogs';
import {
  EMULATOR_CAPTURE_REQUESTED_ENV,
  installEmulatorCaptureAsync,
  parseExperimentalEmulatorCaptureVersionInput,
} from '../utils/emulatorCapture';
import { parseLogSourcesInput } from '../utils/logSourcesInput';

const ANDROID_STARTUP_ATTEMPT_TIMEOUT_MS = [60_000, 120_000, 180_000];
const ANDROID_STARTUP_RETRIES_COUNT = ANDROID_STARTUP_ATTEMPT_TIMEOUT_MS.length - 1;

const ANDROID_SYSTEM_IMAGE_PACKAGE_REGEX =
  /^system-images;android-[A-Za-z0-9._-]+;[A-Za-z0-9._-]+;[A-Za-z0-9._-]+$/;

const HOST_ARCH_SUPPORTED_ABIS: Record<
  string,
  { supported: readonly string[]; recommended: string } | undefined
> = {
  x64: { supported: ['x86_64', 'x86'], recommended: 'x86_64' },
  arm64: { supported: ['arm64-v8a'], recommended: 'arm64-v8a' },
  ia32: { supported: ['x86'], recommended: 'x86' },
};

const SDKMANAGER_TRANSIENT_FAILURE_PATTERNS = [
  /failed to download any source lists/i,
  /io exception while downloading/i,
  /connection (?:reset|refused|timed out)/i,
  /sockettimeoutexception/i,
  /unknownhostexception/i,
  /connectexception/i,
  /sslhandshakeexception/i,
  /temporary failure in name resolution/i,
  /could not resolve host/i,
  /http(?: error| status)?\s*(?:429|5\d{2})/i,
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getSdkManagerPackageNotFoundPatterns(systemImagePackage: string): RegExp[] {
  const escapedPackage = escapeRegExp(systemImagePackage);
  const exactPackagePattern = `(?:'${escapedPackage}'|"${escapedPackage}"|${escapedPackage}(?=$|[\\s,;:!?)]|\\.(?:$|\\s)))`;
  return [
    new RegExp(`failed to find package\\s+${exactPackagePattern}`, 'i'),
    new RegExp(`package\\s+${exactPackagePattern}(?:\\s+with revision\\s+\\S+)?\\s+not found`, 'i'),
    new RegExp(`(?:unknown|invalid) package[:\\s]+${exactPackagePattern}`, 'i'),
  ];
}

export function validateAndroidSystemImagePackage(
  systemImagePackage: string,
  hostArch: string = os.arch()
): void {
  const hostAbiConfig = HOST_ARCH_SUPPORTED_ABIS[hostArch];
  const exampleAbi = hostAbiConfig?.recommended ?? 'x86_64';

  if (!ANDROID_SYSTEM_IMAGE_PACKAGE_REGEX.test(systemImagePackage)) {
    throw new UserError(
      'EAS_ANDROID_EMULATOR_INVALID_SYSTEM_IMAGE',
      `Invalid Android system image package "${systemImagePackage}". Expected a package in the format "system-images;android-<api-level>;<tag>;<abi>", for example "system-images;android-35;default;${exampleAbi}".`
    );
  }

  const [prefix, apiLevel, tag, abi] = systemImagePackage.split(';');
  if (hostAbiConfig && !hostAbiConfig.supported.includes(abi)) {
    const suggestedPackage = `${prefix};${apiLevel};${tag};${hostAbiConfig.recommended}`;
    throw new UserError(
      'EAS_ANDROID_EMULATOR_INVALID_SYSTEM_IMAGE',
      `Android system image "${systemImagePackage}" uses ABI "${abi}", which is incompatible with this ${hostArch} runner. Use an image matching the runner architecture (${hostAbiConfig.supported.join(' or ')}), for example "${suggestedPackage}".`
    );
  }
}

function getSpawnOutput(value: unknown): string {
  if (!value || typeof value !== 'object') {
    return '';
  }
  const candidate = value as {
    stdout?: unknown;
    stderr?: unknown;
    output?: unknown;
    message?: unknown;
  };
  const parts: string[] = [];
  if (typeof candidate.stdout === 'string' && candidate.stdout) {
    parts.push(candidate.stdout);
  }
  if (typeof candidate.stderr === 'string' && candidate.stderr) {
    parts.push(candidate.stderr);
  }
  if (parts.length === 0 && Array.isArray(candidate.output)) {
    for (const entry of candidate.output) {
      if (typeof entry === 'string' && entry) {
        parts.push(entry);
      }
    }
  }
  if (typeof candidate.message === 'string' && candidate.message) {
    parts.push(candidate.message);
  }
  return parts.join('\n');
}

function matchesSdkManagerPackageNotFoundOutput(
  output: string,
  systemImagePackage: string
): boolean {
  return getSdkManagerPackageNotFoundPatterns(systemImagePackage).some(pattern =>
    pattern.test(output)
  );
}

function isSdkManagerPackageNotFoundOutput(output: string, systemImagePackage: string): boolean {
  return (
    matchesSdkManagerPackageNotFoundOutput(output, systemImagePackage) &&
    !SDKMANAGER_TRANSIENT_FAILURE_PATTERNS.some(pattern => pattern.test(output))
  );
}

function isRetryableEmulatorStartupError(err: unknown): boolean {
  if (err instanceof UserError) {
    return false;
  }
  if (err instanceof AndroidEmulatorExitedError) {
    return err.isRetryable;
  }
  return true;
}

async function installAndroidSystemImageAsync({
  systemImagePackage,
  env,
  logger,
}: {
  systemImagePackage: string;
  env: BuildStepEnv;
  logger: bunyan;
}): Promise<void> {
  logger.info('Making sure system image is installed');
  await retryAsync(
    async () => {
      try {
        const result = await spawn('sdkmanager', [systemImagePackage], {
          env,
          logger,
        });
        const output = getSpawnOutput(result);
        if (isSdkManagerPackageNotFoundOutput(output, systemImagePackage)) {
          throw new UserError(
            'EAS_ANDROID_EMULATOR_SYSTEM_IMAGE_NOT_FOUND',
            `Android system image "${systemImagePackage}" was not found by sdkmanager. Verify that the package exists in the Android SDK repository (run \`sdkmanager --list\` to see available system images).`
          );
        }
        if (matchesSdkManagerPackageNotFoundOutput(output, systemImagePackage)) {
          throw new Error(
            `sdkmanager failed to fetch package manifests while installing "${systemImagePackage}".`
          );
        }
      } catch (err) {
        if (err instanceof UserError) {
          throw err;
        }
        const output = getSpawnOutput(err);
        if (isSdkManagerPackageNotFoundOutput(output, systemImagePackage)) {
          throw new UserError(
            'EAS_ANDROID_EMULATOR_SYSTEM_IMAGE_NOT_FOUND',
            `Android system image "${systemImagePackage}" was not found by sdkmanager. Verify that the package exists in the Android SDK repository (run \`sdkmanager --list\` to see available system images).`,
            { cause: err }
          );
        }
        throw err;
      }
    },
    {
      logger,
      retryOptions: {
        retries: 3, // Retry 3 times
        retryIntervalMs: 1_000,
      },
      shouldRetry: err => !(err instanceof UserError),
    }
  );
}

export function createStartAndroidEmulatorBuildFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'start_android_emulator',
    name: 'Start Android Emulator',
    __metricsId: 'eas/start_android_emulator',
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'log_sources',
        required: false,
        defaultValue: [...ALL_ANDROID_EMULATOR_LOG_SOURCES],
        allowedValueTypeName: BuildStepInputValueTypeName.JSON,
      }),
      BuildStepInput.createProvider({
        id: 'device_name',
        required: false,
        defaultValue: 'EasAndroidDevice01',
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
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
        id: 'count',
        required: false,
        defaultValue: 1,
        allowedValueTypeName: BuildStepInputValueTypeName.NUMBER,
      }),
      // Experimental: the expo-emulator-capture version that the emulator preloads.
      BuildStepInput.createProvider({
        id: 'experimental_emulator_capture_version',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
    ],
    outputProviders: [
      BuildStepOutput.createProvider({
        id: 'logcat_directory',
        required: true,
      }),
    ],
    fn: async ({ logger, global }, { inputs, outputs, env }) => {
      const count = Number(inputs.count.value ?? 1);
      const emulatorCaptureVersion = parseExperimentalEmulatorCaptureVersionInput(
        inputs.experimental_emulator_capture_version.value
      );
      if (emulatorCaptureVersion && count > 1) {
        throw new UserError(
          'EAS_EMULATOR_CAPTURE_INVALID_INPUT',
          'experimental_emulator_capture_version supports one emulator. Remove it, or set count to 1.'
        );
      }
      const logSources = parseLogSourcesInput(inputs.log_sources.value, {
        runtimePlatform: global.runtimePlatform,
        fallback: ALL_ANDROID_EMULATOR_LOG_SOURCES,
      });
      const systemImagePackage = `${inputs.system_image_package.value}`;
      validateAndroidSystemImagePackage(systemImagePackage);
      if (emulatorCaptureVersion) {
        // Marks the request for the session step, which rejects session types that cannot use
        // the capture. The mark does not depend on the install, so the rejection does not either.
        global.updateEnv({
          ...global.env,
          [EMULATOR_CAPTURE_REQUESTED_ENV]: emulatorCaptureVersion,
        });
      }
      const emulatorCaptureLibrary = emulatorCaptureVersion
        ? await installEmulatorCaptureAsync({ version: emulatorCaptureVersion, env, logger })
        : undefined;

      const logcatDirectory = await fs.promises.mkdtemp(
        path.join(os.tmpdir(), 'eas-android-emulator-logcat-')
      );
      const logCapture = getAndroidEmulatorLogCapture(global, env, logSources);
      outputs.logcat_directory.set(logcatDirectory);

      const deviceName = `${inputs.device_name.value}` as AndroidVirtualDeviceName;
      const { serialId, emulatorPromise, shouldAdjustAnimationScale, emulatorCaptureSocketPath } =
        await startAndroidEmulatorAsync({
          deviceName,
          systemImagePackage,
          // We can cast because allowedValueTypeName validated this is a string.
          deviceIdentifier: inputs.device_identifier.value as AndroidDeviceName | undefined,
          lcdWidth: inputs.lcd_width.value as number | undefined,
          lcdHeight: inputs.lcd_height.value as number | undefined,
          lcdDensity: inputs.lcd_density.value as number | undefined,
          logcatDirectory,
          logCapture,
          env,
          logger,
          emulatorCaptureLibrary,
        });
      if (emulatorCaptureLibrary && emulatorCaptureSocketPath) {
        // The session step starts expo-device-hub with the job env. A Hub version without the
        // emulator capture ignores these variables.
        global.updateEnv({
          ...global.env,
          EXPO_DEVICE_HUB_EXPERIMENTAL_EMULATOR_CAPTURE: '1',
          EXPO_DEVICE_HUB_EMULATOR_CAPTURE_LIBRARY: emulatorCaptureLibrary,
        });
        logger.info(
          `${serialId} preloads expo-emulator-capture@${emulatorCaptureVersion}, and its agent socket is ${emulatorCaptureSocketPath}. Later steps start expo-device-hub with the emulator capture on.`
        );
      }

      if (count > 1) {
        logger.info(`Requested ${count} emulators, shutting down ${deviceName} for cloning.`);
        await spawn('adb', ['-s', serialId, 'shell', 'reboot', '-p'], {
          logger,
          env,
        });
        // Waiting for source emulator to shutdown.
        // We don't care about resolved/rejected.
        await asyncResult(emulatorPromise);

        for (let i = 0; i < count; i++) {
          const cloneIdentifier = `eas-simulator-${i + 1}` as AndroidVirtualDeviceName;
          await retryAsync(
            async attemptCount => {
              const timeoutMs = ANDROID_STARTUP_ATTEMPT_TIMEOUT_MS[attemptCount];
              const attempt = attemptCount + 1;
              const maxAttempts = ANDROID_STARTUP_ATTEMPT_TIMEOUT_MS.length;
              const attemptSuffix = attempt > 1 ? ` (attempt ${attempt}/${maxAttempts})` : '';
              let cloneSerialId = null;
              try {
                logger.info(`Cloning ${deviceName} to ${cloneIdentifier}${attemptSuffix}.`);
                await AndroidEmulatorUtils.cloneAsync({
                  sourceDeviceName: deviceName,
                  destinationDeviceName: cloneIdentifier,
                  env,
                  logger,
                });

                logger.info(`Starting emulator device${attemptSuffix}.`);
                const startResult = await AndroidEmulatorUtils.startAsync({
                  deviceName: cloneIdentifier,
                  env,
                  logcatDirectory,
                  logCapture,
                });
                cloneSerialId = startResult.serialId;

                logger.info('Waiting for emulator to become ready');
                await AndroidEmulatorUtils.waitForReadyAsync({
                  serialId: cloneSerialId,
                  env,
                  timeoutMs,
                  logger,
                  emulatorPromise: startResult.emulatorPromise,
                });
                if (shouldAdjustAnimationScale) {
                  await AndroidEmulatorUtils.disableWindowAndTransitionAnimationsAsync({
                    env,
                    logger,
                    serialId: cloneSerialId,
                  });
                }

                logger.info(`${cloneIdentifier} is ready.`);
              } catch (err) {
                logger.warn(
                  { err },
                  `${cloneIdentifier} failed to start on attempt ${attempt}/${maxAttempts}.`
                );
                try {
                  if (err instanceof AndroidEmulatorExitedError) {
                    await AndroidEmulatorUtils.deleteAsync({
                      deviceName: cloneIdentifier,
                      env,
                      skipStop: true,
                    });
                  } else if (cloneSerialId) {
                    await AndroidEmulatorUtils.deleteAsync({
                      serialId: cloneSerialId,
                      deviceName: cloneIdentifier,
                      env,
                    });
                  } else {
                    await AndroidEmulatorUtils.deleteAsync({
                      deviceName: cloneIdentifier,
                      env,
                    });
                  }
                } catch (cleanupErr) {
                  logger.warn({ err: cleanupErr }, `Failed to clean up ${cloneIdentifier}.`);
                }
                throw err;
              }
            },
            {
              logger,
              retryOptions: {
                retries: ANDROID_STARTUP_RETRIES_COUNT,
                retryIntervalMs: 1_000,
              },
              shouldRetry: isRetryableEmulatorStartupError,
            }
          );
        }
      }
    },
  });
}

/**
 * Checks the host, installs the system image, then creates and starts one emulator and
 * waits until it is ready, with retries.
 */
export async function startAndroidEmulatorAsync({
  deviceName,
  systemImagePackage,
  deviceIdentifier,
  lcdWidth,
  lcdHeight,
  lcdDensity,
  logcatDirectory,
  logCapture,
  env,
  logger,
  emulatorCaptureLibrary,
}: {
  deviceName: AndroidVirtualDeviceName;
  systemImagePackage: string;
  deviceIdentifier?: AndroidDeviceName;
  lcdWidth?: number;
  lcdHeight?: number;
  lcdDensity?: number;
  logcatDirectory: string;
  logCapture: AndroidEmulatorLogCapture;
  env: BuildStepEnv;
  logger: bunyan;
  /** The expo-emulator-capture agent library that the emulator preloads (experimental). */
  emulatorCaptureLibrary?: string;
}): Promise<{
  serialId: AndroidDeviceSerialId;
  emulatorPromise: Promise<unknown>;
  shouldAdjustAnimationScale: boolean;
  /** The capture agent's socket, when the emulator preloads the agent on the expected serial. */
  emulatorCaptureSocketPath?: string;
}> {
  validateAndroidSystemImagePackage(systemImagePackage);

  if (env.EAS_NO_EMULATOR_HOST_SUPPORT_CHECK !== '1') {
    await assertAndroidEmulatorHostSupportAsync({ env });
  } else {
    logger.info(
      'Skipping Android emulator host support check because $EAS_NO_EMULATOR_HOST_SUPPORT_CHECK is enabled.'
    );
  }

  try {
    const availableDevices = await AndroidEmulatorUtils.getAvailableDevicesAsync({ env });
    logger.info(`Available Android devices:\n- ${availableDevices.join(`\n- `)}`);
  } catch (error) {
    logger.info('Failed to list available Android devices.', error);
  } finally {
    logger.info('');
  }

  const shouldAdjustAnimationScale =
    env.ANDROID_EMULATOR_ADJUST_ANIMATION_SCALE !== 'false' &&
    env.ANDROID_EMULATOR_ADJUST_ANIMATION_SCALE !== '0';

  if (!shouldAdjustAnimationScale) {
    logger.info(
      'Skipping Android emulator animation scale adjustments because $ANDROID_EMULATOR_ADJUST_ANIMATION_SCALE is disabled.'
    );
  }

  const localEgress = await resolveAndroidEmulatorLocalEgressAsync();

  await installAndroidSystemImageAsync({ systemImagePackage, env, logger });

  // expo-device-hub gets the job env and finds the agent sockets in `<tmpdir>/expo-emulator-capture`,
  // where Node's os.tmpdir() applies this rule to that env. On EAS, TMPDIR is not set.
  const captureSocketDirectory = path.join(
    env.TMPDIR || env.TMP || env.TEMP || '/tmp',
    'expo-emulator-capture'
  );
  let emulatorPromise = null;
  let serialId = null;
  // Set by the attempt that starts; the cast keeps the type wide after the retry callback.
  let captureLaunch = undefined as { consolePort: number; socketPath: string } | undefined;
  await retryAsync(
    async attemptCount => {
      const timeoutMs = ANDROID_STARTUP_ATTEMPT_TIMEOUT_MS[attemptCount];
      const attempt = attemptCount + 1;
      const maxAttempts = ANDROID_STARTUP_ATTEMPT_TIMEOUT_MS.length;
      const attemptSuffix = attempt > 1 ? ` (attempt ${attempt}/${maxAttempts})` : '';
      let attemptSerialId = null;

      try {
        logger.info(`Creating emulator device${attemptSuffix}.`);
        await AndroidEmulatorUtils.createAsync({
          deviceName,
          systemImagePackage,
          deviceIdentifier: deviceIdentifier ?? null,
          lcdWidth: lcdWidth ?? null,
          lcdHeight: lcdHeight ?? null,
          lcdDensity: lcdDensity ?? null,
          env,
          logger,
        });

        logger.info(`Starting emulator device${attemptSuffix}.`);
        // expo-device-hub finds the capture agent's socket by the serial, so the console port,
        // which sets the serial, is chosen before the start, again for each attempt.
        const consolePort = emulatorCaptureLibrary
          ? await AndroidEmulatorUtils.findFreeConsolePortAsync()
          : undefined;
        const launch =
          consolePort !== undefined
            ? {
                consolePort,
                socketPath: path.join(captureSocketDirectory, `emulator-${consolePort}.sock`),
              }
            : undefined;
        const startResult = await AndroidEmulatorUtils.startAsync({
          deviceName,
          env,
          logcatDirectory,
          logCapture,
          ...(localEgress ? { launchGate: localEgress.launchGate } : {}),
          ...(emulatorCaptureLibrary && launch
            ? {
                consolePort: launch.consolePort,
                extraEnv: {
                  // A library that the job already preloads stays preloaded, after the agent.
                  LD_PRELOAD: [emulatorCaptureLibrary, env.LD_PRELOAD].filter(Boolean).join(':'),
                  // The agent creates the directory.
                  EXPO_EMULATOR_CAPTURE_SOCKET: launch.socketPath,
                },
              }
            : {}),
        });
        attemptSerialId = startResult.serialId;
        await AndroidEmulatorUtils.waitForReadyAsync({
          env,
          serialId: attemptSerialId,
          timeoutMs,
          logger,
          emulatorPromise: startResult.emulatorPromise,
          ...(localEgress ? { networkReadyTarget: localEgress.networkReadyTarget } : {}),
        });
        if (shouldAdjustAnimationScale) {
          await AndroidEmulatorUtils.disableWindowAndTransitionAnimationsAsync({
            env,
            logger,
            serialId: attemptSerialId,
          });
        }
        await localEgress?.configureBootedEmulatorAsync({ serialId: attemptSerialId, logger });
        logger.info(`${deviceName} is ready.`);

        serialId = attemptSerialId;
        emulatorPromise = startResult.emulatorPromise;
        captureLaunch = launch;
      } catch (err) {
        logger.warn({ err }, `${deviceName} failed to start on attempt ${attempt}/${maxAttempts}.`);
        try {
          if (err instanceof AndroidEmulatorExitedError) {
            await AndroidEmulatorUtils.deleteAsync({
              deviceName,
              env,
              skipStop: true,
            });
          } else if (attemptSerialId) {
            await AndroidEmulatorUtils.deleteAsync({
              serialId: attemptSerialId,
              deviceName,
              env,
            });
          } else {
            await AndroidEmulatorUtils.deleteAsync({
              deviceName,
              env,
            });
          }
        } catch (cleanupErr) {
          logger.warn({ err: cleanupErr }, `Failed to clean up ${deviceName}.`);
        }
        throw err;
      }
    },
    {
      logger,
      retryOptions: {
        retries: ANDROID_STARTUP_RETRIES_COUNT,
        retryIntervalMs: 1_000,
      },
      shouldRetry: isRetryableEmulatorStartupError,
    }
  );

  if (!serialId || !emulatorPromise) {
    throw new Error(`Failed to start emulator ${deviceName}.`);
  }
  // The Hub looks for the socket by serial. $ANDROID_EMULATOR_EXTRA_ARGS can override -port.
  if (captureLaunch && serialId !== `emulator-${captureLaunch.consolePort}`) {
    logger.warn(
      `${serialId} does not use console port ${captureLaunch.consolePort}, so expo-device-hub cannot find its capture agent socket ${captureLaunch.socketPath}. The session streams without the emulator capture. Remove -port from $ANDROID_EMULATOR_EXTRA_ARGS.`
    );
    captureLaunch = undefined;
  }
  return {
    serialId,
    emulatorPromise,
    shouldAdjustAnimationScale,
    emulatorCaptureSocketPath: captureLaunch?.socketPath,
  };
}

async function assertAndroidEmulatorHostSupportAsync({
  env,
}: {
  env: NodeJS.ProcessEnv;
}): Promise<void> {
  const isAndroidEmulatorHostSupported = await isAndroidEmulatorHostSupportedAsync(env);
  if (!isAndroidEmulatorHostSupported) {
    throw new UserError(
      'ANDROID_EMULATOR_ACCEL_CHECK_UNAVAILABLE',
      'Could not start the Android emulator on this runner.\n\n' +
        'Android emulator requires nested virtualization on Linux. This job does not have the required virtualization support.\n\n' +
        'Update your workflow YAML to use a nested-virtualization Linux runner, for example:\n' +
        '  runs_on: linux-medium-nested-virtualization\n' +
        '  runs_on: linux-large-nested-virtualization\n\n' +
        'See https://docs.expo.dev/eas/workflows/syntax/#jobsjob_idruns_on for more information.'
    );
  }
}

async function isAndroidEmulatorHostSupportedAsync(env: NodeJS.ProcessEnv): Promise<boolean> {
  const androidSdkPath = env.ANDROID_HOME ?? env.ANDROID_SDK_ROOT ?? '';
  try {
    await spawn(`${androidSdkPath}/emulator/emulator`, ['-accel-check'], { env });
    return true;
  } catch {
    return false;
  }
}
