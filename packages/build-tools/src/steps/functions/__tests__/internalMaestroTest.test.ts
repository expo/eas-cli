import { spawnAsync } from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import { vol } from 'memfs';
import os from 'os';

import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { createMockLogger } from '../../../__tests__/utils/logger';
import { AndroidEmulatorUtils } from '../../../utils/AndroidEmulatorUtils';
import { IosSimulatorUtils } from '../../../utils/IosSimulatorUtils';
import { findMaestroPathsFlowsToExecuteAsync } from '../../../utils/findMaestroPathsFlowsToExecuteAsync';
import { retryAsync } from '../../../utils/retry';
import { createInternalEasMaestroTestFunction } from '../internalMaestroTest';

jest.mock('@expo/steps', () => ({
  ...jest.requireActual('@expo/steps'),
  spawnAsync: jest.fn(),
}));

jest.mock('@expo/turtle-spawn', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock('../../../utils/IosSimulatorUtils');
jest.mock('../../../utils/AndroidEmulatorUtils');
jest.mock('../../../utils/findMaestroPathsFlowsToExecuteAsync');
jest.mock('../../../utils/retry', () => ({
  retryAsync: jest.fn(),
}));

const mockedSpawnAsync = jest.mocked(spawnAsync);
const mockedSpawn = jest.mocked(spawn);
const mockedRetryAsync = jest.mocked(retryAsync);
const mockedAndroidUtils = jest.mocked(AndroidEmulatorUtils);
const mockedIosUtils = jest.mocked(IosSimulatorUtils);
const mockedFindFlows = jest.mocked(findMaestroPathsFlowsToExecuteAsync);

describe(createInternalEasMaestroTestFunction, () => {
  const mockUploadArtifact = jest.fn();

  beforeEach(() => {
    vol.mkdirSync(os.tmpdir(), { recursive: true });

    mockedSpawnAsync.mockResolvedValue(undefined as any);
    mockedSpawn.mockResolvedValue({ stdout: 'source-emulator\n', stderr: '' } as any);
    mockUploadArtifact.mockResolvedValue({ artifactId: null });

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

    mockedIosUtils.getAvailableDevicesAsync.mockResolvedValue([
      { name: 'iPhone 15', udid: 'test-udid-123' } as any,
    ]);
    mockedIosUtils.cloneAsync.mockResolvedValue(undefined as any);
    mockedIosUtils.startAsync.mockResolvedValue({ udid: 'cloned-udid' } as any);
    mockedIosUtils.waitForReadyAsync.mockResolvedValue(undefined as any);
    mockedIosUtils.collectLogsAsync.mockResolvedValue({ outputPath: '/tmp/logs.txt' } as any);
    mockedIosUtils.deleteAsync.mockResolvedValue(undefined as any);

    mockedAndroidUtils.getAttachedDevicesAsync.mockResolvedValue([
      { serialId: 'emulator-5554', state: 'device' } as any,
    ]);
    mockedAndroidUtils.cloneAsync.mockResolvedValue(undefined as any);
    mockedAndroidUtils.startAsync.mockResolvedValue({
      serialId: 'emulator-5556',
      emulatorPromise: Promise.resolve({}),
    } as any);
    mockedAndroidUtils.waitForReadyAsync.mockResolvedValue(undefined as any);
    mockedAndroidUtils.collectLogsAsync.mockResolvedValue({ outputPath: '/tmp/logs.txt' } as any);
    mockedAndroidUtils.deleteAsync.mockResolvedValue(undefined as any);

    mockedFindFlows.mockResolvedValue(['/project/.maestro/home.yml']);
  });

  function createStep(overrides?: { callInputs?: Record<string, unknown> }) {
    const ctx = {
      runtimeApi: { uploadArtifact: mockUploadArtifact },
    };
    const fn = createInternalEasMaestroTestFunction(ctx as any);
    return fn.createBuildStepFromFunctionCall(
      createGlobalContextMock({
        logger: createMockLogger(),
      }),
      {
        callInputs: {
          platform: 'ios',
          flow_paths: JSON.stringify(['.maestro']),
          ...overrides?.callInputs,
        },
      }
    );
  }

  it('sets junit_report_directory output when output_format is junit', async () => {
    const step = createStep({
      callInputs: { output_format: 'junit' },
    });
    await step.executeAsync();

    const junitDir = step.getOutputValueByName('junit_report_directory');
    expect(junitDir).toMatch(/maestro-reports-/);
  });

  it('does not set junit_report_directory output when output_format is not junit', async () => {
    const step = createStep();
    await step.executeAsync();

    const junitDir = step.getOutputValueByName('junit_report_directory');
    expect(junitDir).toBeUndefined();
  });

  it('does not set junit_report_directory when function throws before reaching output code', async () => {
    mockedIosUtils.getAvailableDevicesAsync.mockResolvedValue([]);

    const step = createStep({
      callInputs: { output_format: 'junit' },
    });

    try {
      await step.executeAsync();
    } catch {
      // Expected - no booted device found
    }

    const junitDir = step.getOutputValueByName('junit_report_directory');
    expect(junitDir).toBeUndefined();
  });

  it('retries Android clone startup with increasing timeouts', async () => {
    mockedAndroidUtils.startAsync
      .mockResolvedValueOnce({
        serialId: 'emulator-attempt-1',
        emulatorPromise: Promise.resolve({}),
      } as any)
      .mockResolvedValueOnce({
        serialId: 'emulator-attempt-2',
        emulatorPromise: Promise.resolve({}),
      } as any);
    mockedAndroidUtils.waitForReadyAsync
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValueOnce(undefined);

    const step = createStep({
      callInputs: { platform: 'android' },
    });

    await step.executeAsync();

    expect(mockedAndroidUtils.waitForReadyAsync).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        serialId: 'emulator-attempt-1',
        timeoutMs: 60_000,
      })
    );
    expect(mockedAndroidUtils.waitForReadyAsync).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        serialId: 'emulator-attempt-2',
        timeoutMs: 120_000,
      })
    );
    expect(mockedAndroidUtils.deleteAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        serialId: 'emulator-attempt-1',
        deviceName: 'eas-simulator-0-0',
      })
    );
  });

  it('generates per-attempt report filenames when retrying', async () => {
    // Mock sequence:
    // 1. xcrun simctl shutdown → succeeds (beforeEach default is fine)
    // 2. maestro test attempt 0 → fails (triggers retry)
    // 3. maestro test attempt 1 → succeeds (beforeEach default)
    mockedSpawnAsync
      .mockResolvedValueOnce(undefined as any) // xcrun simctl shutdown
      .mockRejectedValueOnce(new Error('Maestro test failed')); // maestro attempt 0
    // Attempt 1 falls through to beforeEach's mockResolvedValue default

    const step = createStep({
      callInputs: { output_format: 'junit', retries: 2 },
    });
    await step.executeAsync();

    // Filter to just the maestro test command calls (skip xcrun simctl shutdown)
    const maestroCalls = mockedSpawnAsync.mock.calls.filter(([cmd]) => cmd === 'maestro');
    expect(maestroCalls).toHaveLength(2);

    // Extract --output paths from maestro calls
    const outputArgs = maestroCalls.map(([, args]) => args[args.indexOf('--output') + 1]);

    expect(outputArgs[0]).toContain('attempt-0');
    expect(outputArgs[1]).toContain('attempt-1');
    // Filenames must be unique (not overwriting)
    expect(outputArgs[0]).not.toBe(outputArgs[1]);
  });

  it('fails Android flow when clone startup exhausts all attempts', async () => {
    mockedAndroidUtils.startAsync
      .mockResolvedValueOnce({
        serialId: 'emulator-attempt-1',
        emulatorPromise: Promise.resolve({}),
      } as any)
      .mockResolvedValueOnce({
        serialId: 'emulator-attempt-2',
        emulatorPromise: Promise.resolve({}),
      } as any)
      .mockResolvedValueOnce({
        serialId: 'emulator-attempt-3',
        emulatorPromise: Promise.resolve({}),
      } as any);
    mockedAndroidUtils.waitForReadyAsync.mockRejectedValue(new Error('network unavailable'));

    const step = createStep({
      callInputs: { platform: 'android' },
    });

    await expect(step.executeAsync()).rejects.toThrow('network unavailable');

    expect(mockedAndroidUtils.waitForReadyAsync).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        serialId: 'emulator-attempt-3',
        timeoutMs: 180_000,
      })
    );
  });
});
