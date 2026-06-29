import spawn from '@expo/turtle-spawn';

import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { createMockLogger } from '../../../__tests__/utils/logger';
import { IosSimulatorUtils } from '../../../utils/IosSimulatorUtils';
import { createStartIosSimulatorBuildFunction } from '../startIosSimulator';

jest.mock('@expo/turtle-spawn', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock('../../../utils/IosSimulatorUtils', () => ({
  IosSimulatorUtils: {
    getAvailableDevicesAsync: jest.fn(),
    getDeviceAsync: jest.fn(),
    cloneAsync: jest.fn(),
    startAsync: jest.fn(),
    waitForReadyAsync: jest.fn(),
    disableApsdAsync: jest.fn(),
  },
}));

const mockedSpawn = jest.mocked(spawn);
const mockedUtils = jest.mocked(IosSimulatorUtils);

function createStep(callInputs?: Record<string, unknown>) {
  const logger = createMockLogger();
  const fn = createStartIosSimulatorBuildFunction();
  const globalCtx = createGlobalContextMock({ logger });
  const step = fn.createBuildStepFromFunctionCall(globalCtx, { callInputs });
  return Object.assign(step, { logger });
}

describe(createStartIosSimulatorBuildFunction, () => {
  beforeEach(() => {
    mockedSpawn.mockResolvedValue({ stdout: '', stderr: '' } as any);
    mockedUtils.getAvailableDevicesAsync.mockResolvedValue([]);
    mockedUtils.getDeviceAsync.mockResolvedValue(null);
    mockedUtils.cloneAsync.mockResolvedValue(undefined);
    mockedUtils.startAsync.mockResolvedValue({ udid: 'test-udid' as any });
    mockedUtils.waitForReadyAsync.mockResolvedValue(undefined);
    mockedUtils.disableApsdAsync.mockResolvedValue(undefined);
  });

  it('disables apsd on the main device and every clone', async () => {
    mockedUtils.startAsync
      .mockResolvedValueOnce({ udid: 'base' as any })
      .mockResolvedValueOnce({ udid: 'clone-1' as any })
      .mockResolvedValueOnce({ udid: 'clone-2' as any });

    await createStep({ device_identifier: 'iPhone 15', count: 2 }).executeAsync();

    expect(mockedUtils.disableApsdAsync).toHaveBeenCalledWith({
      udid: 'base',
      env: expect.any(Object),
    });
    expect(mockedUtils.disableApsdAsync).toHaveBeenCalledWith({
      udid: 'clone-1',
      env: expect.any(Object),
    });
    expect(mockedUtils.disableApsdAsync).toHaveBeenCalledWith({
      udid: 'clone-2',
      env: expect.any(Object),
    });
  });

  it('continues when disabling apsd fails', async () => {
    mockedUtils.disableApsdAsync.mockRejectedValue(new Error('apsd disable failed'));

    await createStep({ device_identifier: 'iPhone 15', count: 2 }).executeAsync();

    // Startup is not aborted: readiness is still awaited for each device.
    expect(mockedUtils.waitForReadyAsync).toHaveBeenCalled();
  });

  it('outputs the booted device udid for a single-device run', async () => {
    mockedUtils.startAsync.mockResolvedValue({ udid: 'booted-udid' as any });

    const step = createStep({ device_identifier: 'iPhone 15' });
    await step.executeAsync();

    expect(step.outputById.device_udid.value).toBe('booted-udid');
  });

  it('does not set device_udid for a multi-device run', async () => {
    mockedUtils.startAsync
      .mockResolvedValueOnce({ udid: 'base' as any })
      .mockResolvedValueOnce({ udid: 'clone-1' as any })
      .mockResolvedValueOnce({ udid: 'clone-2' as any });

    const step = createStep({ device_identifier: 'iPhone 15', count: 2 });
    await step.executeAsync();

    expect(step.outputById.device_udid.value).toBeUndefined();
  });
});
