import spawn from '@expo/turtle-spawn';

import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { createMockLogger } from '../../../__tests__/utils/logger';
import { IosSimulatorUtils } from '../../../utils/IosSimulatorUtils';
import { bootResidentIosSimulatorAsync } from '../../utils/residentIosSimulator';
import { createStartIosSimulatorBuildFunction } from '../startIosSimulator';

jest.mock('@expo/turtle-spawn');
jest.mock('../../../utils/IosSimulatorUtils');
jest.mock('../../utils/residentIosSimulator');

const UDIDS: Record<string, string> = {
  'iPhone 15': 'base',
  'eas-simulator-1': 'clone-1',
  'eas-simulator-2': 'clone-2',
};

function createStep(callInputs?: Record<string, unknown>) {
  const logger = createMockLogger();
  const global = createGlobalContextMock({ logger });
  return createStartIosSimulatorBuildFunction().createBuildStepFromFunctionCall(global, {
    callInputs,
  });
}

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(spawn).mockResolvedValue({ stdout: '', stderr: '' } as never);
  jest.mocked(IosSimulatorUtils.getAvailableDevicesAsync).mockResolvedValue([]);
  jest.mocked(IosSimulatorUtils.getDeviceAsync).mockResolvedValue(null);
  jest
    .mocked(IosSimulatorUtils.resolveUdidAsync)
    .mockImplementation(
      async ({ deviceIdentifier }) => (UDIDS[deviceIdentifier] ?? deviceIdentifier) as never
    );
});

it('uses resident startup for an ordinary standalone boot', async () => {
  await createStep({ device_identifier: 'iPhone 15' }).executeAsync();
  expect(bootResidentIosSimulatorAsync).toHaveBeenCalledWith(
    expect.objectContaining({ udid: 'base' })
  );
  expect(IosSimulatorUtils.enableAccessibilitySettingsAsync).not.toHaveBeenCalled();
});

it('enrolls each clone separately before proxy setup and readiness', async () => {
  await createStep({ device_identifier: 'iPhone 15', count: 2 }).executeAsync();
  const devices = ['base', 'clone-1', 'clone-2'];
  expect(jest.mocked(bootResidentIosSimulatorAsync).mock.calls.map(([{ udid }]) => udid)).toEqual(
    devices
  );
  expect(IosSimulatorUtils.bootAsync).not.toHaveBeenCalled();
  expect(IosSimulatorUtils.cloneAsync).toHaveBeenCalledTimes(2);
  expect(IosSimulatorUtils.startAsync).not.toHaveBeenCalled();
});

it('sets accessibility before booting the source and each clone', async () => {
  await createStep({
    device_identifier: 'iPhone 15',
    count: 2,
    enable_accessibility_settings: true,
  }).executeAsync();
  for (const [index, name] of ['iPhone 15', 'eas-simulator-1', 'eas-simulator-2'].entries()) {
    expect(IosSimulatorUtils.enableAccessibilitySettingsAsync).toHaveBeenCalledWith({
      deviceIdentifier: name,
      env: expect.any(Object),
    });
    expect(
      jest.mocked(IosSimulatorUtils.enableAccessibilitySettingsAsync).mock.invocationCallOrder[
        index
      ]
    ).toBeLessThan(jest.mocked(bootResidentIosSimulatorAsync).mock.invocationCallOrder[index]!);
  }
});

it('fails before proxy setup, app readiness or cloning if resident admission fails', async () => {
  jest
    .mocked(bootResidentIosSimulatorAsync)
    .mockRejectedValue(new Error('native admission failed'));
  await expect(
    createStep({ device_identifier: 'iPhone 15', count: 2 }).executeAsync()
  ).rejects.toThrow('native admission failed');
  expect(IosSimulatorUtils.startAsync).not.toHaveBeenCalled();
  expect(IosSimulatorUtils.cloneAsync).not.toHaveBeenCalled();
});

it('selects the shortest iPhone name when no device is specified', async () => {
  jest.mocked(IosSimulatorUtils.getAvailableDevicesAsync).mockResolvedValue([
    { name: 'iPhone 17 Pro', udid: 'pro' },
    { name: 'iPad', udid: 'ipad' },
    { name: 'iPhone 17', udid: 'base' },
  ] as never);
  await createStep().executeAsync();
  expect(bootResidentIosSimulatorAsync).toHaveBeenCalledWith(
    expect.objectContaining({ udid: 'base' })
  );
});
