import type { ChildProcess } from 'node:child_process';

import spawn, { type SpawnPromise, type SpawnResult } from '@expo/turtle-spawn';

import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { createMockLogger } from '../../../__tests__/utils/logger';
import {
  AndroidEmulatorUtils,
  AndroidVirtualDeviceName,
} from '../../../utils/AndroidEmulatorUtils';
import { retryAsync } from '../../../utils/retry';
import { createStartAndroidEmulatorBuildFunction } from '../startAndroidEmulator';

jest.mock('@expo/turtle-spawn', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock('../../../utils/retry', () => ({
  retryAsync: jest.fn(),
}));

jest.mock('../../../utils/AndroidEmulatorUtils', () => ({
  AndroidEmulatorUtils: {
    defaultSystemImagePackage: 'system-images;android-30;default;x86_64',
    getAvailableDevicesAsync: jest.fn(),
    createAsync: jest.fn(),
    cloneAsync: jest.fn(),
    startAsync: jest.fn(),
    waitForReadyAsync: jest.fn(),
    disableWindowAndTransitionAnimationsAsync: jest.fn(),
    deleteAsync: jest.fn(),
  },
}));

const ORIGINAL_PROCESS_PLATFORM = process.platform;

const mockedSpawn = jest.mocked(spawn);
const mockedRetryAsync = jest.mocked(retryAsync);
const mockedAndroidUtils = jest.mocked(AndroidEmulatorUtils);

function setProcessPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', {
    value: platform,
    configurable: true,
    enumerable: true,
    writable: false,
  });
}

function restoreProcessPlatform(): void {
  setProcessPlatform(ORIGINAL_PROCESS_PLATFORM as NodeJS.Platform);
}

function createSpawnPromiseWithStdout(stdout: string, stderr = ''): SpawnPromise<SpawnResult> {
  const result: SpawnResult = {
    stdout,
    stderr,
    status: 0,
    output: [stdout, stderr],
    signal: null,
  };
  const promise = Promise.resolve(result) as SpawnPromise<SpawnResult>;
  promise.child = {} as ChildProcess;
  return promise;
}

function createStep(callInputs?: Record<string, unknown>, envOverrides?: NodeJS.ProcessEnv) {
  const logger = createMockLogger();
  const fn = createStartAndroidEmulatorBuildFunction();
  const globalCtx = createGlobalContextMock({ logger });
  globalCtx.updateEnv({ HOME: '/home/expo', ANDROID_HOME: '/android/home', ...envOverrides });
  const step = fn.createBuildStepFromFunctionCall(globalCtx, {
    callInputs,
  });
  return Object.assign(step, { logger });
}

function createStartResult(serialId: string) {
  return {
    serialId: serialId as any,
    emulatorPromise: Promise.resolve({}) as any,
  } as any;
}

describe(createStartAndroidEmulatorBuildFunction, () => {
  beforeEach(() => {
    mockedSpawn.mockResolvedValue({ stdout: '', stderr: '' } as any);
    mockedAndroidUtils.getAvailableDevicesAsync.mockResolvedValue([]);
    mockedAndroidUtils.createAsync.mockResolvedValue(undefined);
    mockedAndroidUtils.cloneAsync.mockResolvedValue(undefined);
    mockedAndroidUtils.startAsync.mockResolvedValue(createStartResult('emulator-default'));
    mockedAndroidUtils.waitForReadyAsync.mockResolvedValue(undefined);
    mockedAndroidUtils.disableWindowAndTransitionAnimationsAsync.mockResolvedValue(undefined);
    mockedAndroidUtils.deleteAsync.mockResolvedValue(undefined);

    mockedRetryAsync.mockImplementation(async (fn, { retryOptions }) => {
      let lastErr: unknown;
      for (let attemptCount = 0; attemptCount <= retryOptions.retries; attemptCount++) {
        try {
          return await fn(attemptCount);
        } catch (err) {
          lastErr = err;
        }
      }
      throw lastErr;
    });
  });

  afterEach(() => {
    restoreProcessPlatform();
  });

  describe('emulator startup', () => {
    beforeEach(() => {
      setProcessPlatform('darwin');
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
    });

    it('skips animation scale adjustments when opt out env var is disabled', async () => {
      const step = createStep(undefined, {
        ANDROID_EMULATOR_ADJUST_ANIMATION_SCALE: 'false',
      });

      await step.executeAsync();

      expect(mockedAndroidUtils.disableWindowAndTransitionAnimationsAsync).not.toHaveBeenCalled();
    });
  });

  describe('nested virtualization probe', () => {
    it('logs and fails on Linux when EAS_BUILD_NESTED_VIRTUALIZATION_ENABLED is unset', async () => {
      setProcessPlatform('linux');

      const step = createStep(undefined, { EAS_BUILD_OTHER: '1' });

      await expect(step.executeAsync()).rejects.toThrow(/nested virtualization/i);

      const stepLoggerChild = (step.logger.child as jest.Mock).mock.results[0]?.value as {
        error: jest.Mock;
      };
      expect(stepLoggerChild.error).toHaveBeenCalledWith(
        expect.stringMatching(/nested virtualization/i)
      );
      expect(mockedAndroidUtils.getAvailableDevicesAsync).toHaveBeenCalled();
      expect(
        mockedSpawn.mock.calls.some((args: unknown[]) => (args[0] as string) === 'sdkmanager')
      ).toBe(false);
      expect(mockedSpawn.mock.calls.some((args: unknown[]) => (args[0] as string) === 'grep')).toBe(
        false
      );
    });

    it('throws an error that mentions nested-virtualization runs_on examples when Linux check fails', async () => {
      setProcessPlatform('linux');

      await expect(createStep().executeAsync()).rejects.toThrow(
        /linux-medium-nested-virtualization[\s\S]+linux-large-nested-virtualization/
      );
    });

    it('invokes sdkmanager as the first spawn on Linux when EAS_BUILD_NESTED_VIRTUALIZATION_ENABLED is 1', async () => {
      setProcessPlatform('linux');

      await createStep(undefined, {
        EAS_BUILD_NESTED_VIRTUALIZATION_ENABLED: '1',
      }).executeAsync();

      expect(mockedSpawn.mock.calls[0]?.[0]).toBe('sdkmanager');
      expect(mockedSpawn.mock.calls.some((args: unknown[]) => (args[0] as string) === 'grep')).toBe(
        false
      );
    });

    it('does not run grep when not on Linux', async () => {
      setProcessPlatform('darwin');

      await createStep().executeAsync();

      expect(mockedSpawn.mock.calls.some((args: unknown[]) => (args[0] as string) === 'grep')).toBe(
        false
      );
    });

    it('does not run grep when on win32', async () => {
      setProcessPlatform('win32');

      await createStep().executeAsync();

      expect(mockedSpawn.mock.calls.some((args: unknown[]) => (args[0] as string) === 'grep')).toBe(
        false
      );
    });

    it('uses EAS_BUILD_NESTED_VIRTUALIZATION_ENABLED on Linux when set to 1', async () => {
      setProcessPlatform('linux');

      await createStep(undefined, {
        EAS_BUILD_NESTED_VIRTUALIZATION_ENABLED: '1',
      }).executeAsync();

      expect(
        mockedSpawn.mock.calls.some((args: unknown[]) => (args[0] as string) === 'sdkmanager')
      ).toBe(true);
    });

    it('fails on Linux when EAS_BUILD_NESTED_VIRTUALIZATION_ENABLED is 0', async () => {
      setProcessPlatform('linux');

      const step = createStep(undefined, {
        EAS_BUILD_NESTED_VIRTUALIZATION_ENABLED: '0',
      });

      await expect(step.executeAsync()).rejects.toThrow(/nested virtualization/i);

      expect(
        mockedSpawn.mock.calls.some((args: unknown[]) => (args[0] as string) === 'sdkmanager')
      ).toBe(false);
    });
  });
});
