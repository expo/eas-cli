import { UserError } from '@expo/eas-build-job';
import spawn from '@expo/turtle-spawn';
import fs from 'node:fs';
import os from 'node:os';

import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { createMockLogger } from '../../../__tests__/utils/logger';
import {
  AndroidEmulatorExitedError,
  AndroidEmulatorUtils,
  AndroidVirtualDeviceName,
} from '../../../utils/AndroidEmulatorUtils';
import { retryAsync } from '../../../utils/retry';
import { resolveAndroidEmulatorLocalEgressAsync } from '../../utils/androidLocalEgress';
import { AndroidEmulatorLogRing } from '../../../utils/androidEmulatorLogCapture';
import { getAndroidEmulatorLogCapture } from '../../utils/androidEmulatorLogs';
import { installEmulatorCaptureAsync } from '../../utils/emulatorCapture';
import {
  createStartAndroidEmulatorBuildFunction,
  validateAndroidSystemImagePackage,
} from '../startAndroidEmulator';

jest.mock('@expo/turtle-spawn', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock('../../../utils/retry', () => ({
  retryAsync: jest.fn(),
}));

jest.mock('../../utils/androidLocalEgress', () => ({
  resolveAndroidEmulatorLocalEgressAsync: jest.fn(),
}));

jest.mock('../../utils/androidEmulatorLogs');

jest.mock('../../utils/emulatorCapture', () => ({
  ...jest.requireActual('../../utils/emulatorCapture'),
  installEmulatorCaptureAsync: jest.fn(),
}));

jest.mock('../../../utils/AndroidEmulatorUtils', () => ({
  AndroidEmulatorExitedError: jest.requireActual('../../../utils/AndroidEmulatorUtils')
    .AndroidEmulatorExitedError,
  AndroidEmulatorUtils: {
    defaultSystemImagePackage: 'system-images;android-30;default;x86_64',
    getAvailableDevicesAsync: jest.fn(),
    createAsync: jest.fn(),
    cloneAsync: jest.fn(),
    startAsync: jest.fn(),
    waitForReadyAsync: jest.fn(),
    disableWindowAndTransitionAnimationsAsync: jest.fn(),
    deleteAsync: jest.fn(),
    findFreeConsolePortAsync: jest.fn(),
  },
}));

const mockedSpawn = jest.mocked(spawn);
const mockedRetryAsync = jest.mocked(retryAsync);
const mockedAndroidUtils = jest.mocked(AndroidEmulatorUtils);
const mockedResolveLocalEgress = jest.mocked(resolveAndroidEmulatorLocalEgressAsync);
const mockedMkdtemp = jest.spyOn(fs.promises, 'mkdtemp');
const mockedArch = jest.spyOn(os, 'arch');
function createStep(callInputs?: Record<string, unknown>, envOverrides?: NodeJS.ProcessEnv) {
  const logger = createMockLogger();
  const fn = createStartAndroidEmulatorBuildFunction();
  const globalCtx = createGlobalContextMock({ logger });
  globalCtx.updateEnv({ HOME: '/home/expo', ANDROID_HOME: '/android/home', ...envOverrides });
  const step = fn.createBuildStepFromFunctionCall(globalCtx, {
    callInputs,
  });
  return Object.assign(step, { logger, globalCtx });
}

/** The logger that the step function gets: a child of the base logger. */
function stepLogger(step: ReturnType<typeof createStep>) {
  return jest.mocked(step.logger.child).mock.results[0].value;
}

function createStartResult(serialId: string) {
  return {
    serialId: serialId as any,
    emulatorPromise: Promise.resolve({}) as any,
  } as any;
}

describe(createStartAndroidEmulatorBuildFunction, () => {
  beforeEach(() => {
    jest
      .mocked(getAndroidEmulatorLogCapture)
      .mockImplementation(
        jest.requireActual('../../utils/androidEmulatorLogs').getAndroidEmulatorLogCapture
      );
    mockedArch.mockReturnValue('x64');
    mockedMkdtemp.mockResolvedValue('/tmp/logcat-directory');
    mockedSpawn.mockResolvedValue({ stdout: '', stderr: '' } as any);
    mockedAndroidUtils.getAvailableDevicesAsync.mockResolvedValue([]);
    mockedAndroidUtils.createAsync.mockResolvedValue(undefined);
    mockedAndroidUtils.cloneAsync.mockResolvedValue(undefined);
    mockedAndroidUtils.startAsync.mockResolvedValue(createStartResult('emulator-default'));
    mockedAndroidUtils.waitForReadyAsync.mockResolvedValue(undefined);
    mockedAndroidUtils.disableWindowAndTransitionAnimationsAsync.mockResolvedValue(undefined);
    mockedAndroidUtils.deleteAsync.mockResolvedValue(undefined);
    mockedResolveLocalEgress.mockResolvedValue(null);

    mockedRetryAsync.mockImplementation(async (fn, { retryOptions, shouldRetry }) => {
      let lastErr: unknown;
      for (let attemptCount = 0; attemptCount <= retryOptions.retries; attemptCount++) {
        try {
          return await fn(attemptCount);
        } catch (err) {
          lastErr = err;
          if (shouldRetry && !shouldRetry(err)) {
            throw err;
          }
        }
      }
      throw lastErr;
    });
  });

  afterAll(() => {
    mockedMkdtemp.mockRestore();
    mockedArch.mockRestore();
  });

  it('preserves an explicit empty source list and one capture through boot retries and clones', async () => {
    mockedAndroidUtils.waitForReadyAsync.mockRejectedValueOnce(new Error('retry boot'));
    const capture = new AndroidEmulatorLogRing({ sources: [] });
    jest.mocked(getAndroidEmulatorLogCapture).mockReturnValue(capture);
    await createStep(
      { log_sources: [], count: 2 },
      { DEVICE_RUN_SESSION_ID: 'session' }
    ).executeAsync();
    expect(getAndroidEmulatorLogCapture).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ DEVICE_RUN_SESSION_ID: 'session' }),
      []
    );
    expect(mockedAndroidUtils.startAsync).toHaveBeenCalledTimes(4);
    for (const [options] of mockedAndroidUtils.startAsync.mock.calls) {
      expect(options.logCapture).toBe(capture);
    }
  });

  it('rejects invalid sources before starting the emulator', async () => {
    await expect(createStep({ log_sources: ['unknown'] }).executeAsync()).rejects.toThrow();
    expect(mockedAndroidUtils.startAsync).not.toHaveBeenCalled();
  });

  describe('local egress', () => {
    function createLocalEgress() {
      return {
        launchGate: {
          emulatorArgs: ['-http-proxy', '127.0.0.1:8898', '-no-metrics'],
          wrapperCommand: 'bash',
          wrapperArgs: ['-c', 'gate', 'eas-egress-gate'],
          admitAsync: jest.fn(),
        },
        networkReadyTarget: { host: '192.0.2.1', port: 443 },
        configureBootedEmulatorAsync: jest.fn().mockResolvedValue(undefined),
      };
    }

    it('starts the emulator exactly as before without a local egress session', async () => {
      await createStep().executeAsync();

      expect(mockedAndroidUtils.startAsync).toHaveBeenCalledWith({
        deviceName: 'EasAndroidDevice01',
        env: expect.any(Object),
        logcatDirectory: '/tmp/logcat-directory',
        logCapture: expect.objectContaining({ sources: ['emulator-output', 'device-logcat'] }),
      });
      expect(mockedAndroidUtils.waitForReadyAsync).toHaveBeenCalledWith({
        env: expect.any(Object),
        serialId: 'emulator-default',
        timeoutMs: 60_000,
        logger: expect.anything(),
        emulatorPromise: expect.any(Promise),
      });
      expect(
        mockedSpawn.mock.calls.filter(
          ([command, args]) =>
            ['sudo', 'nft', 'systemd-run'].includes(command) ||
            (command === 'adb' && (args.includes('reverse') || args.includes('http_proxy')))
        )
      ).toEqual([]);
    });

    it('fences, gates and configures the emulator', async () => {
      const localEgress = createLocalEgress();
      mockedResolveLocalEgress.mockResolvedValue(localEgress);
      mockedAndroidUtils.startAsync.mockResolvedValueOnce(createStartResult('emulator-base'));

      await createStep().executeAsync();

      expect(mockedAndroidUtils.startAsync).toHaveBeenCalledWith(
        expect.objectContaining({ launchGate: localEgress.launchGate })
      );
      expect(mockedAndroidUtils.waitForReadyAsync).toHaveBeenCalledWith(
        expect.objectContaining({ networkReadyTarget: { host: '192.0.2.1', port: 443 } })
      );
      expect(localEgress.configureBootedEmulatorAsync).toHaveBeenCalledWith(
        expect.objectContaining({ serialId: 'emulator-base' })
      );
    });

    it('retries a boot whose local egress configuration fails', async () => {
      const localEgress = createLocalEgress();
      localEgress.configureBootedEmulatorAsync
        .mockRejectedValueOnce(new Error('netsimd outside the fence'))
        .mockResolvedValueOnce(undefined);
      mockedResolveLocalEgress.mockResolvedValue(localEgress);
      mockedAndroidUtils.startAsync
        .mockResolvedValueOnce(createStartResult('emulator-1111'))
        .mockResolvedValueOnce(createStartResult('emulator-2222'));

      await createStep().executeAsync();

      expect(mockedAndroidUtils.deleteAsync).toHaveBeenCalledWith(
        expect.objectContaining({ serialId: 'emulator-1111' })
      );
      expect(localEgress.configureBootedEmulatorAsync).toHaveBeenLastCalledWith(
        expect.objectContaining({ serialId: 'emulator-2222' })
      );
    });
  });

  it('passes profile and LCD inputs to emulator creation', async () => {
    const systemImagePackage = 'system-images;android-35;default;x86_64';
    await createStep({
      device_identifier: 'medium_phone',
      system_image_package: systemImagePackage,
      lcd_width: 720,
      lcd_height: 1600,
      lcd_density: 262,
    }).executeAsync();

    expect(mockedSpawn).toHaveBeenCalledWith('sdkmanager', [systemImagePackage], expect.anything());
    expect(mockedAndroidUtils.createAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceIdentifier: 'medium_phone',
        systemImagePackage,
        lcdWidth: 720,
        lcdHeight: 1600,
        lcdDensity: 262,
      })
    );
    expect(mockedAndroidUtils.createAsync.mock.invocationCallOrder[0]).toBeLessThan(
      mockedAndroidUtils.startAsync.mock.invocationCallOrder[0]
    );
  });

  it('retries base emulator startup with increasing readiness timeouts', async () => {
    mockedAndroidUtils.startAsync
      .mockResolvedValueOnce(createStartResult('emulator-1111'))
      .mockResolvedValueOnce(createStartResult('emulator-2222'));
    mockedAndroidUtils.waitForReadyAsync
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValueOnce(undefined);

    await createStep().executeAsync();

    expect(mockedAndroidUtils.waitForReadyAsync).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        serialId: 'emulator-1111',
        timeoutMs: 60_000,
      })
    );
    expect(mockedAndroidUtils.waitForReadyAsync).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        serialId: 'emulator-2222',
        timeoutMs: 120_000,
      })
    );
    expect(mockedAndroidUtils.disableWindowAndTransitionAnimationsAsync).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        serialId: 'emulator-2222',
      })
    );
    expect(mockedAndroidUtils.startAsync).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        deviceName: 'EasAndroidDevice01',
        logcatDirectory: '/tmp/logcat-directory',
      })
    );
    expect(mockedAndroidUtils.startAsync).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        deviceName: 'EasAndroidDevice01',
        logcatDirectory: '/tmp/logcat-directory',
      })
    );
    expect(mockedAndroidUtils.deleteAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        serialId: 'emulator-1111',
      })
    );
  });

  it('retries clone startup independently and cleans up failed clone attempts', async () => {
    mockedAndroidUtils.startAsync
      .mockResolvedValueOnce(createStartResult('emulator-base'))
      .mockResolvedValueOnce(createStartResult('emulator-clone-1-attempt-1'))
      .mockResolvedValueOnce(createStartResult('emulator-clone-1-attempt-2'))
      .mockResolvedValueOnce(createStartResult('emulator-clone-2-attempt-1'));

    mockedAndroidUtils.waitForReadyAsync
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('clone network unavailable'))
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    await createStep({ count: 2 }).executeAsync();

    expect(mockedAndroidUtils.waitForReadyAsync).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        serialId: 'emulator-base',
        timeoutMs: 60_000,
      })
    );
    expect(mockedAndroidUtils.waitForReadyAsync).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        serialId: 'emulator-clone-1-attempt-1',
        timeoutMs: 60_000,
      })
    );
    expect(mockedAndroidUtils.waitForReadyAsync).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        serialId: 'emulator-clone-1-attempt-2',
        timeoutMs: 120_000,
      })
    );
    expect(mockedAndroidUtils.waitForReadyAsync).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        serialId: 'emulator-clone-2-attempt-1',
        timeoutMs: 60_000,
      })
    );
    expect(mockedAndroidUtils.disableWindowAndTransitionAnimationsAsync).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        serialId: 'emulator-base',
      })
    );
    expect(mockedAndroidUtils.disableWindowAndTransitionAnimationsAsync).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        serialId: 'emulator-clone-1-attempt-2',
      })
    );
    expect(mockedAndroidUtils.disableWindowAndTransitionAnimationsAsync).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        serialId: 'emulator-clone-2-attempt-1',
      })
    );
    expect(mockedAndroidUtils.startAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceName: 'EasAndroidDevice01',
        logcatDirectory: '/tmp/logcat-directory',
      })
    );
    expect(mockedAndroidUtils.startAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceName: 'eas-simulator-1',
        logcatDirectory: '/tmp/logcat-directory',
      })
    );
    expect(mockedAndroidUtils.startAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceName: 'eas-simulator-2',
        logcatDirectory: '/tmp/logcat-directory',
      })
    );

    expect(mockedAndroidUtils.deleteAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        serialId: 'emulator-clone-1-attempt-1',
        deviceName: 'eas-simulator-1' as AndroidVirtualDeviceName,
      })
    );
  });

  it('fails after exhausting all startup attempts', async () => {
    mockedAndroidUtils.startAsync
      .mockResolvedValueOnce(createStartResult('emulator-attempt-1'))
      .mockResolvedValueOnce(createStartResult('emulator-attempt-2'))
      .mockResolvedValueOnce(createStartResult('emulator-attempt-3'));
    mockedAndroidUtils.waitForReadyAsync.mockRejectedValue(new Error('network unavailable'));

    await expect(createStep().executeAsync()).rejects.toThrow('network unavailable');

    expect(mockedAndroidUtils.waitForReadyAsync).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        serialId: 'emulator-attempt-3',
        timeoutMs: 180_000,
      })
    );
    expect(mockedAndroidUtils.deleteAsync).toHaveBeenCalledTimes(3);
    expect(mockedAndroidUtils.startAsync).toHaveBeenCalledTimes(3);
  });

  it('outputs and uses a temporary logcat directory', async () => {
    const step = createStep();
    await step.executeAsync();

    expect(mockedAndroidUtils.startAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        logcatDirectory: '/tmp/logcat-directory',
      })
    );
    expect(step.getOutputValueByName('logcat_directory')).toBe('/tmp/logcat-directory');
    expect(mockedAndroidUtils.waitForReadyAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        serialId: 'emulator-default',
      })
    );
  });

  it('skips animation scale adjustments when opt out env var is disabled', async () => {
    const step = createStep(undefined, {
      ANDROID_EMULATOR_ADJUST_ANIMATION_SCALE: 'false',
    });

    await step.executeAsync();

    expect(mockedAndroidUtils.disableWindowAndTransitionAnimationsAsync).not.toHaveBeenCalled();
  });

  it('fails early on Linux when emulator host support check fails', async () => {
    mockedSpawn.mockRejectedValueOnce(new Error('accel check failed') as any);

    const step = createStep();
    await expect(step.executeAsync()).rejects.toThrow(/nested virtualization/i);

    expect(mockedSpawn).toHaveBeenCalledWith('/android/home/emulator/emulator', ['-accel-check'], {
      env: expect.any(Object),
    });
    expect(mockedSpawn.mock.calls.some(([command]) => command === 'sdkmanager')).toBe(false);
  });

  it('continues startup on Linux when emulator host support check succeeds', async () => {
    await createStep().executeAsync();

    expect(mockedSpawn).toHaveBeenCalledWith('/android/home/emulator/emulator', ['-accel-check'], {
      env: expect.any(Object),
    });
    expect(mockedSpawn.mock.calls.some(([command]) => command === 'sdkmanager')).toBe(true);
  });

  it('skips emulator host support check when opt out env var is enabled', async () => {
    const step = createStep(undefined, {
      EAS_NO_EMULATOR_HOST_SUPPORT_CHECK: '1',
    });

    await step.executeAsync();

    expect(mockedSpawn.mock.calls.some(([command]) => command.includes('/emulator/emulator'))).toBe(
      false
    );
    expect(mockedSpawn.mock.calls.some(([command]) => command === 'sdkmanager')).toBe(true);
  });

  it('falls back to empty SDK path when Android SDK path env vars are missing', async () => {
    await createStep(undefined, {
      ANDROID_HOME: undefined,
      ANDROID_SDK_ROOT: undefined,
    }).executeAsync();

    expect(mockedSpawn).toHaveBeenCalledWith('/emulator/emulator', ['-accel-check'], {
      env: expect.any(Object),
    });
  });

  it('uses ANDROID_SDK_ROOT when ANDROID_HOME is missing', async () => {
    await createStep(undefined, {
      ANDROID_HOME: undefined,
      ANDROID_SDK_ROOT: '/android/sdk/root',
    }).executeAsync();

    expect(mockedSpawn).toHaveBeenCalledWith(
      '/android/sdk/root/emulator/emulator',
      ['-accel-check'],
      {
        env: expect.any(Object),
      }
    );
  });

  describe('experimental emulator capture', () => {
    const LIBRARY = '/tmp/package/libexpo_emulator_capture.so';
    const mockedInstall = jest.mocked(installEmulatorCaptureAsync);

    function captureStart(port: number) {
      return {
        deviceName: 'EasAndroidDevice01',
        env: expect.any(Object),
        logcatDirectory: '/tmp/logcat-directory',
        logCapture: expect.objectContaining({ sources: ['emulator-output', 'device-logcat'] }),
        consolePort: port,
        extraEnv: {
          LD_PRELOAD: LIBRARY,
          EXPO_EMULATOR_CAPTURE_SOCKET: `/tmp/job/expo-emulator-capture/emulator-${port}.sock`,
        },
      };
    }

    beforeEach(() => {
      mockedInstall.mockReset().mockResolvedValue(LIBRARY);
      mockedAndroidUtils.findFreeConsolePortAsync
        .mockReset()
        .mockResolvedValueOnce(5554)
        .mockResolvedValueOnce(5556);
      mockedAndroidUtils.startAsync.mockResolvedValue(createStartResult('emulator-5554'));
    });

    it('preloads the agent and turns the capture on for expo-device-hub', async () => {
      const step = createStep(
        { experimental_emulator_capture_version: '0.1.0' },
        { TMPDIR: '/tmp/job' }
      );

      await step.executeAsync();

      expect(mockedInstall).toHaveBeenCalledWith({
        version: '0.1.0',
        env: expect.any(Object),
        logger: expect.anything(),
      });
      expect(mockedAndroidUtils.startAsync).toHaveBeenCalledWith(captureStart(5554));
      expect(step.globalCtx.env).toMatchObject({
        EXPO_DEVICE_HUB_EXPERIMENTAL_EMULATOR_CAPTURE: '1',
        EXPO_DEVICE_HUB_EMULATOR_CAPTURE_LIBRARY: LIBRARY,
      });
      expect(stepLogger(step).info).toHaveBeenCalledWith(
        'emulator-5554 preloads expo-emulator-capture@0.1.0, and its agent socket is /tmp/job/expo-emulator-capture/emulator-5554.sock. Later steps start expo-device-hub with the emulator capture on.'
      );
    });

    it('uses the temporary directory rule of Node when TMPDIR is empty', async () => {
      await createStep(
        { experimental_emulator_capture_version: '0.1.0' },
        { TMPDIR: '', TMP: '/tmp/from-tmp' }
      ).executeAsync();

      expect(mockedAndroidUtils.startAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          extraEnv: expect.objectContaining({
            EXPO_EMULATOR_CAPTURE_SOCKET: '/tmp/from-tmp/expo-emulator-capture/emulator-5554.sock',
          }),
        })
      );
    });

    it('uses /tmp when the job env names no temporary directory', async () => {
      await createStep({ experimental_emulator_capture_version: '0.1.0' }).executeAsync();

      expect(mockedAndroidUtils.startAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          extraEnv: expect.objectContaining({
            EXPO_EMULATOR_CAPTURE_SOCKET: '/tmp/expo-emulator-capture/emulator-5554.sock',
          }),
        })
      );
    });

    it('does not turn the capture on when the emulator runs on another console port', async () => {
      mockedAndroidUtils.startAsync.mockResolvedValue(createStartResult('emulator-5560'));
      const step = createStep(
        { experimental_emulator_capture_version: '0.1.0' },
        { TMPDIR: '/tmp/job' }
      );

      await step.executeAsync();

      expect(step.globalCtx.env.EXPO_DEVICE_HUB_EXPERIMENTAL_EMULATOR_CAPTURE).toBeUndefined();
      expect(stepLogger(step).warn).toHaveBeenCalledWith(
        expect.stringContaining('emulator-5560 does not use console port 5554')
      );
    });

    it('keeps a library that the job already preloads, after the agent', async () => {
      await createStep(
        { experimental_emulator_capture_version: '0.1.0' },
        { TMPDIR: '/tmp/job', LD_PRELOAD: '/opt/other.so' }
      ).executeAsync();

      expect(mockedAndroidUtils.startAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          extraEnv: expect.objectContaining({ LD_PRELOAD: `${LIBRARY}:/opt/other.so` }),
        })
      );
    });

    it('chooses a new console port for each start attempt', async () => {
      mockedAndroidUtils.startAsync
        .mockRejectedValueOnce(new Error('emulator did not start'))
        .mockResolvedValue(createStartResult('emulator-5556'));

      await createStep(
        { experimental_emulator_capture_version: '0.1.0' },
        { TMPDIR: '/tmp/job' }
      ).executeAsync();

      expect(mockedAndroidUtils.startAsync).toHaveBeenNthCalledWith(2, captureStart(5556));
    });

    it('starts the emulator as without the input when the install fails', async () => {
      mockedInstall.mockResolvedValue(undefined);
      const step = createStep({ experimental_emulator_capture_version: '0.1.0' });

      await step.executeAsync();

      expect(mockedAndroidUtils.startAsync).toHaveBeenCalledWith({
        deviceName: 'EasAndroidDevice01',
        env: expect.any(Object),
        logcatDirectory: '/tmp/logcat-directory',
        logCapture: expect.objectContaining({ sources: ['emulator-output', 'device-logcat'] }),
      });
      expect(mockedAndroidUtils.findFreeConsolePortAsync).not.toHaveBeenCalled();
      expect(step.globalCtx.env.EXPO_DEVICE_HUB_EXPERIMENTAL_EMULATOR_CAPTURE).toBeUndefined();
      // The session step still rejects session types without the capture.
      expect(step.globalCtx.env.EAS_EXPERIMENTAL_EMULATOR_CAPTURE_VERSION).toBe('0.1.0');
    });

    it('installs nothing without the input', async () => {
      const step = createStep();

      await step.executeAsync();

      expect(mockedInstall).not.toHaveBeenCalled();
      expect(mockedAndroidUtils.findFreeConsolePortAsync).not.toHaveBeenCalled();
      expect(step.globalCtx.env.EXPO_DEVICE_HUB_EXPERIMENTAL_EMULATOR_CAPTURE).toBeUndefined();
      expect(step.globalCtx.env.EAS_EXPERIMENTAL_EMULATOR_CAPTURE_VERSION).toBeUndefined();
    });

    it('rejects the capture for more than one emulator before it starts one', async () => {
      await expect(
        createStep({ experimental_emulator_capture_version: '0.1.0', count: 2 }).executeAsync()
      ).rejects.toThrow('experimental_emulator_capture_version supports one emulator');

      expect(mockedInstall).not.toHaveBeenCalled();
      expect(mockedAndroidUtils.startAsync).not.toHaveBeenCalled();
    });

    it('rejects a version that is not an exact npm version or a dist-tag', async () => {
      await expect(
        createStep({ experimental_emulator_capture_version: 'npm:other@1.0.0' }).executeAsync()
      ).rejects.toThrow('must be an npm version or dist-tag of expo-emulator-capture');

      expect(mockedInstall).not.toHaveBeenCalled();
    });
  });

  describe('system image validation and sdkmanager fail-fast', () => {
    it.each([
      'android-35;google_apis_playstore;x86_64',
      'platforms;android-35',
      'system-images;android-35;google_apis_playstore',
      'system-images;35;default;x86_64',
      ' system-images;android-35;default;x86_64 ',
      '',
    ])('rejects malformed system_image_package %j before running sdkmanager', async invalidPkg => {
      const error = await createStep({ system_image_package: invalidPkg })
        .executeAsync()
        .catch(err => err);

      expect(error).toBeInstanceOf(UserError);
      expect(error.errorCode).toBe('EAS_ANDROID_EMULATOR_INVALID_SYSTEM_IMAGE');
      expect(error.message).toContain('system-images;android-<api-level>;<tag>;<abi>');
      expect(mockedSpawn).not.toHaveBeenCalled();
      expect(mockedAndroidUtils.createAsync).not.toHaveBeenCalled();
    });

    it('rejects arm64-v8a system image on an x64 runner before running sdkmanager', async () => {
      mockedArch.mockReturnValue('x64');

      const error = await createStep({
        system_image_package: 'system-images;android-35;google_apis_playstore;arm64-v8a',
      })
        .executeAsync()
        .catch(err => err);

      expect(error).toBeInstanceOf(UserError);
      expect(error.errorCode).toBe('EAS_ANDROID_EMULATOR_INVALID_SYSTEM_IMAGE');
      expect(error.message).toContain('incompatible with this x64 runner');
      expect(error.message).toContain('system-images;android-35;google_apis_playstore;x86_64');
      expect(mockedSpawn).not.toHaveBeenCalled();
    });

    it('rejects x86_64 system image on an arm64 runner before running sdkmanager', async () => {
      mockedArch.mockReturnValue('arm64');

      const error = await createStep({
        system_image_package: 'system-images;android-35;google_apis_playstore;x86_64',
      })
        .executeAsync()
        .catch(err => err);

      expect(error).toBeInstanceOf(UserError);
      expect(error.errorCode).toBe('EAS_ANDROID_EMULATOR_INVALID_SYSTEM_IMAGE');
      expect(error.message).toContain('incompatible with this arm64 runner');
      expect(error.message).toContain('system-images;android-35;google_apis_playstore;arm64-v8a');
      expect(mockedSpawn).not.toHaveBeenCalled();
    });

    it('accepts valid custom x86_64/x86 images on x64 and arm64-v8a on arm64', () => {
      expect(() =>
        validateAndroidSystemImagePackage(
          'system-images;android-35-ext15;google_apis_playstore_ps16k;x86_64',
          'x64'
        )
      ).not.toThrow();
      expect(() =>
        validateAndroidSystemImagePackage('system-images;android-30;default;x86', 'x64')
      ).not.toThrow();
      expect(() =>
        validateAndroidSystemImagePackage('system-images;android-36;google_apis;arm64-v8a', 'arm64')
      ).not.toThrow();
    });

    it('fails immediately without retrying when sdkmanager reports package not found on non-zero exit', async () => {
      const systemImagePackage = 'system-images;android-37;google_apis_playstore;x86_64';
      const sdkError = Object.assign(new Error('sdkmanager exited with non-zero code: 1'), {
        stdout: '',
        stderr: `Warning: Failed to find package '${systemImagePackage}'\n`,
        status: 1,
      });
      mockedSpawn.mockImplementation(((command: string) => {
        if (command === 'sdkmanager') {
          return Promise.reject(sdkError);
        }
        return Promise.resolve({ stdout: '', stderr: '' });
      }) as any);

      const error = await createStep({ system_image_package: systemImagePackage })
        .executeAsync()
        .catch(err => err);

      expect(error).toBeInstanceOf(UserError);
      expect(error.errorCode).toBe('EAS_ANDROID_EMULATOR_SYSTEM_IMAGE_NOT_FOUND');
      expect(error.message).toContain(systemImagePackage);
      expect(mockedSpawn.mock.calls.filter(([command]) => command === 'sdkmanager')).toHaveLength(
        1
      );
    });

    it('fails immediately without retrying when sdkmanager exits 0 with a package not found warning', async () => {
      const systemImagePackage = 'system-images;android-37;google_apis_playstore;x86_64';
      mockedSpawn.mockImplementation(((command: string) => {
        if (command === 'sdkmanager') {
          return Promise.resolve({
            stdout: '',
            stderr: `Warning: Failed to find package '${systemImagePackage}'\n`,
          });
        }
        return Promise.resolve({ stdout: '', stderr: '' });
      }) as any);

      const error = await createStep({ system_image_package: systemImagePackage })
        .executeAsync()
        .catch(err => err);

      expect(error).toBeInstanceOf(UserError);
      expect(error.errorCode).toBe('EAS_ANDROID_EMULATOR_SYSTEM_IMAGE_NOT_FOUND');
      expect(mockedSpawn.mock.calls.filter(([command]) => command === 'sdkmanager')).toHaveLength(
        1
      );
    });

    it('retries sdkmanager on transient manifest download errors even when output mentions package not found', async () => {
      const systemImagePackage = 'system-images;android-35;google_apis_playstore;x86_64';
      const transientError = Object.assign(new Error('sdkmanager exited with non-zero code: 1'), {
        stdout: '',
        stderr: [
          'Warning: Failed to download any source lists!',
          'Warning: IO exception while downloading manifest',
          `Warning: Failed to find package '${systemImagePackage}'`,
        ].join('\n'),
        status: 1,
      });
      let sdkCalls = 0;
      mockedSpawn.mockImplementation(((command: string) => {
        if (command === 'sdkmanager') {
          sdkCalls += 1;
          if (sdkCalls === 1) {
            return Promise.reject(transientError);
          }
        }
        return Promise.resolve({ stdout: '', stderr: '' });
      }) as any);

      await createStep({ system_image_package: systemImagePackage }).executeAsync();

      expect(sdkCalls).toBe(2);
    });

    it('proceeds when sdkmanager exits 0 with an unrelated Invalid package.xml warning', async () => {
      const systemImagePackage = 'system-images;android-35;google_apis_playstore;x86_64';
      mockedSpawn.mockImplementation(((command: string) => {
        if (command === 'sdkmanager') {
          return Promise.resolve({
            stdout: '',
            stderr:
              'Warning: Invalid package.xml found at /android/sdk/extras/vendor/package.xml\n',
          });
        }
        return Promise.resolve({ stdout: '', stderr: '' });
      }) as any);

      await createStep({ system_image_package: systemImagePackage }).executeAsync();

      expect(mockedSpawn.mock.calls.filter(([command]) => command === 'sdkmanager')).toHaveLength(
        1
      );
      expect(mockedAndroidUtils.createAsync).toHaveBeenCalledTimes(1);
    });

    it('proceeds when sdkmanager exits 0 with a warning naming a longer package that shares a prefix', async () => {
      const systemImagePackage = 'system-images;android-30;default;x86';
      mockedSpawn.mockImplementation(((command: string) => {
        if (command === 'sdkmanager') {
          return Promise.resolve({
            stdout: '',
            stderr: [
              "Warning: Failed to find package 'system-images;android-30;default;x86_64'",
              'Warning: Unknown package: system-images;android-30;default;x86_64',
            ].join('\n'),
          });
        }
        return Promise.resolve({ stdout: '', stderr: '' });
      }) as any);

      await createStep({ system_image_package: systemImagePackage }).executeAsync();

      expect(mockedSpawn.mock.calls.filter(([command]) => command === 'sdkmanager')).toHaveLength(
        1
      );
      expect(mockedAndroidUtils.createAsync).toHaveBeenCalledWith(
        expect.objectContaining({ systemImagePackage })
      );
    });

    it('fails immediately when sdkmanager logs a manifest wait progress warning before package not found', async () => {
      const systemImagePackage = 'system-images;android-37;google_apis_playstore;x86_64';
      const sdkError = Object.assign(new Error('sdkmanager exited with non-zero code: 1'), {
        stdout: '',
        stderr: [
          'Warning: Still waiting for package manifests to be fetched remotely.',
          `Warning: Failed to find package '${systemImagePackage}'`,
        ].join('\n'),
        status: 1,
      });
      mockedSpawn.mockImplementation(((command: string) => {
        if (command === 'sdkmanager') {
          return Promise.reject(sdkError);
        }
        return Promise.resolve({ stdout: '', stderr: '' });
      }) as any);

      const error = await createStep({ system_image_package: systemImagePackage })
        .executeAsync()
        .catch(err => err);

      expect(error).toBeInstanceOf(UserError);
      expect(error.errorCode).toBe('EAS_ANDROID_EMULATOR_SYSTEM_IMAGE_NOT_FOUND');
      expect(mockedSpawn.mock.calls.filter(([command]) => command === 'sdkmanager')).toHaveLength(
        1
      );
    });
  });

  describe('non-retryable emulator startup failures', () => {
    it('does not retry a non-retryable AndroidEmulatorExitedError', async () => {
      mockedAndroidUtils.startAsync.mockRejectedValue(
        new AndroidEmulatorExitedError('KVM is required to run this AVD.', {
          exitCode: 1,
          signal: null,
          outputTail: 'ERROR | KVM is required to run this AVD.',
          isRetryable: false,
        })
      );

      await expect(createStep().executeAsync()).rejects.toThrow('KVM is required to run this AVD.');

      expect(mockedAndroidUtils.startAsync).toHaveBeenCalledTimes(1);
      expect(mockedAndroidUtils.deleteAsync).toHaveBeenCalledTimes(1);
      expect(mockedAndroidUtils.deleteAsync).toHaveBeenCalledWith({
        deviceName: 'EasAndroidDevice01',
        env: expect.any(Object),
        skipStop: true,
      });
    });

    it('deletes the AVD by name with skipStop when a registered emulator exits during waitForReadyAsync', async () => {
      mockedAndroidUtils.startAsync
        .mockResolvedValueOnce(createStartResult('emulator-5554'))
        .mockResolvedValueOnce(createStartResult('emulator-5556'));
      mockedAndroidUtils.waitForReadyAsync
        .mockRejectedValueOnce(
          new AndroidEmulatorExitedError('Android emulator exited prematurely.', {
            exitCode: 1,
            signal: null,
            outputTail: 'Segmentation fault',
            isRetryable: true,
          })
        )
        .mockResolvedValueOnce(undefined);

      await createStep().executeAsync();

      expect(mockedAndroidUtils.deleteAsync).toHaveBeenCalledTimes(1);
      expect(mockedAndroidUtils.deleteAsync).toHaveBeenCalledWith({
        deviceName: 'EasAndroidDevice01',
        env: expect.any(Object),
        skipStop: true,
      });
    });

    it('deletes a cloned AVD by name with skipStop when the clone exits during waitForReadyAsync', async () => {
      mockedAndroidUtils.startAsync
        .mockResolvedValueOnce(createStartResult('emulator-base'))
        .mockResolvedValueOnce(createStartResult('emulator-clone-1'))
        .mockResolvedValueOnce(createStartResult('emulator-clone-1-retry'))
        .mockResolvedValueOnce(createStartResult('emulator-clone-2'));
      mockedAndroidUtils.waitForReadyAsync
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(
          new AndroidEmulatorExitedError('Clone exited prematurely.', {
            exitCode: 1,
            signal: null,
            outputTail: 'Segmentation fault',
            isRetryable: true,
          })
        )
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);

      await createStep({ count: 2 }).executeAsync();

      expect(mockedAndroidUtils.deleteAsync).toHaveBeenCalledWith({
        deviceName: 'eas-simulator-1',
        env: expect.any(Object),
        skipStop: true,
      });
    });

    it('retries a retryable AndroidEmulatorExitedError and succeeds on a later attempt', async () => {
      mockedAndroidUtils.startAsync
        .mockRejectedValueOnce(
          new AndroidEmulatorExitedError('Android emulator exited with exit code 1.', {
            exitCode: 1,
            signal: null,
            outputTail: 'Segmentation fault',
            isRetryable: true,
          })
        )
        .mockResolvedValueOnce(createStartResult('emulator-recovered'));

      await createStep().executeAsync();

      expect(mockedAndroidUtils.startAsync).toHaveBeenCalledTimes(2);
      expect(mockedAndroidUtils.waitForReadyAsync).toHaveBeenCalledWith(
        expect.objectContaining({ serialId: 'emulator-recovered' })
      );
    });

    it('does not retry when createAsync throws a UserError', async () => {
      mockedAndroidUtils.createAsync.mockRejectedValue(
        new UserError('EAS_ANDROID_EMULATOR_SYSTEM_IMAGE_NOT_FOUND', 'Invalid AVD system image')
      );

      await expect(createStep().executeAsync()).rejects.toThrow('Invalid AVD system image');

      expect(mockedAndroidUtils.createAsync).toHaveBeenCalledTimes(1);
      expect(mockedAndroidUtils.startAsync).not.toHaveBeenCalled();
    });
  });
});
