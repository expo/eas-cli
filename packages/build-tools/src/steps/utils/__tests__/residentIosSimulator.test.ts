import spawn from '@expo/turtle-spawn';

import { createMockLogger } from '../../../__tests__/utils/logger';
import { IosSimulatorUtils, type IosSimulatorUuid } from '../../../utils/IosSimulatorUtils';
import { waitForWarmSimulatorCleanupAsync } from '../../../utils/warmSimulatorCleanup';
import { findAvailablePortAsync, spawnDetached } from '../remoteDeviceRunSession';
import { bootResidentIosSimulatorAsync } from '../residentIosSimulator';
import { waitForServeSimControlAsync } from '../serveSimControl';
import {
  configureSimulatorProxyEnvironmentAsync,
  readLocalEgressHandoffAsync,
} from '../localEgress';
import { runServeSimActionWithResultAsync } from '../serveSimActions';

jest.mock('@expo/turtle-spawn');
jest.mock('../../../utils/IosSimulatorUtils');
jest.mock('../../../utils/warmSimulatorCleanup');
jest.mock('../serveSimControl');
jest.mock('../serveSimActions');
jest.mock('../localEgress', () => ({
  readLocalEgressHandoffAsync: jest.fn(),
  configureSimulatorProxyEnvironmentAsync: jest.fn(),
}));
jest.mock('../remoteDeviceRunSession', () => ({
  findAvailablePortAsync: jest.fn(),
  spawnDetached: jest.fn(),
}));

const udid = '00000000-0000-4000-8000-000000000001' as IosSimulatorUuid;
const env = {
  SERVE_SIM_VERSION: '0.20.0',
  SERVE_SIM_STATE_DIR: '/owned/state',
  TMPDIR: '/owned/tmp',
};
const logger = createMockLogger();
const stopAsync = jest.fn();
const server = { pid: 10, getOutput: () => '', getExitError: () => undefined, stopAsync };

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(waitForWarmSimulatorCleanupAsync).mockResolvedValue(undefined);
  jest.mocked(readLocalEgressHandoffAsync).mockResolvedValue({ port: 8899 } as never);
  jest.mocked(IosSimulatorUtils.getDeviceAsync).mockResolvedValue({ state: 'Shutdown' } as never);
  jest.mocked(spawn).mockResolvedValue({ stdout: '' } as never);
  jest.mocked(findAvailablePortAsync).mockResolvedValue(4321);
  jest.mocked(spawnDetached).mockReturnValue(server);
  jest.mocked(waitForServeSimControlAsync).mockResolvedValue('private-token');
  jest
    .mocked(runServeSimActionWithResultAsync)
    .mockResolvedValue(JSON.stringify({ available: true, enabled: true }));
  stopAsync.mockResolvedValue(undefined);
});

it('admits one exact device through the pinned serve-sim and then releases only its server', async () => {
  await bootResidentIosSimulatorAsync({ udid, env, logger });
  expect(spawnDetached).toHaveBeenCalledWith(
    expect.objectContaining({
      args: expect.arrayContaining(['@expo/serve-sim@0.20.0', udid, '--enable', 'egressGuard']),
      env,
    })
  );
  expect(waitForServeSimControlAsync).toHaveBeenCalledWith(
    expect.objectContaining({
      device: udid,
      port: 4321,
      stateDir: '/owned/state',
      previewServer: server,
    })
  );
  expect(stopAsync).toHaveBeenCalledTimes(1);
  expect(runServeSimActionWithResultAsync).toHaveBeenCalledWith(
    expect.objectContaining({
      port: 4321,
      token: 'private-token',
      action: 'egress.status',
      params: { udid },
    })
  );
  expect(jest.mocked(waitForServeSimControlAsync).mock.invocationCallOrder[0]).toBeLessThan(
    stopAsync.mock.invocationCallOrder[0]!
  );
  expect(spawn).not.toHaveBeenCalled();
  expect(IosSimulatorUtils.bootAsync).not.toHaveBeenCalled();
  expect(IosSimulatorUtils.startAsync).not.toHaveBeenCalled();
  expect(IosSimulatorUtils.disableApsdAsync).toHaveBeenCalledWith({ udid, env });
  expect(IosSimulatorUtils.waitForReadyAsync).toHaveBeenCalledWith({ udid, env });
  expect(
    jest.mocked(configureSimulatorProxyEnvironmentAsync).mock.invocationCallOrder[0]
  ).toBeLessThan(jest.mocked(IosSimulatorUtils.waitForReadyAsync).mock.invocationCallOrder[0]!);
  expect(jest.mocked(IosSimulatorUtils.waitForReadyAsync).mock.invocationCallOrder[0]).toBeLessThan(
    jest.mocked(runServeSimActionWithResultAsync).mock.invocationCallOrder[0]!
  );
});

it('chooses and verifies pass-through when the job has no local egress', async () => {
  jest.mocked(readLocalEgressHandoffAsync).mockResolvedValue(null);
  jest
    .mocked(runServeSimActionWithResultAsync)
    .mockResolvedValue(JSON.stringify({ available: true, enabled: false }));
  await bootResidentIosSimulatorAsync({ udid, env, logger });
  expect(spawnDetached).toHaveBeenCalledWith(
    expect.objectContaining({ args: expect.arrayContaining(['--disable', 'egressGuard']) })
  );
  expect(stopAsync).toHaveBeenCalledTimes(1);
});

it.each([{ available: false }, { available: true, enabled: false }])(
  'rejects a missing or mismatched policy acknowledgement: %j',
  async status => {
    jest.mocked(runServeSimActionWithResultAsync).mockResolvedValue(JSON.stringify(status));
    await expect(bootResidentIosSimulatorAsync({ udid, env, logger })).rejects.toThrow(
      'did not confirm'
    );
    expect(stopAsync).toHaveBeenCalledTimes(1);
  }
);

it('confirms warm cleanup before shutting down the selected running device', async () => {
  jest.mocked(IosSimulatorUtils.getDeviceAsync).mockResolvedValue({ state: 'Booted' } as never);
  await bootResidentIosSimulatorAsync({ udid, env, logger });
  expect(spawn).toHaveBeenCalledWith('xcrun', ['simctl', 'shutdown', udid], expect.anything());
  expect(jest.mocked(waitForWarmSimulatorCleanupAsync).mock.invocationCallOrder[0]).toBeLessThan(
    jest.mocked(spawn).mock.invocationCallOrder[0]!
  );
  expect(jest.mocked(spawn).mock.invocationCallOrder[0]).toBeLessThan(
    jest.mocked(spawnDetached).mock.invocationCallOrder[0]!
  );
});

it('does not start a server when warm cleanup fails', async () => {
  const error = new Error('cleanup unconfirmed');
  jest.mocked(waitForWarmSimulatorCleanupAsync).mockRejectedValue(error);
  await expect(bootResidentIosSimulatorAsync({ udid, env, logger })).rejects.toBe(error);
  expect(spawn).not.toHaveBeenCalled();
  expect(spawnDetached).not.toHaveBeenCalled();
});

it('stops the temporary server when admission fails', async () => {
  const error = new Error('native admission failed');
  jest.mocked(waitForServeSimControlAsync).mockRejectedValue(error);
  await expect(bootResidentIosSimulatorAsync({ udid, env, logger })).rejects.toBe(error);
  expect(stopAsync).toHaveBeenCalledTimes(1);
});

it('preserves admission and cleanup failures together', async () => {
  const admission = new Error('admission failed');
  const cleanup = new Error('server still running');
  jest.mocked(waitForServeSimControlAsync).mockRejectedValue(admission);
  stopAsync.mockRejectedValue(cleanup);
  await expect(bootResidentIosSimulatorAsync({ udid, env, logger })).rejects.toMatchObject({
    errors: [admission, cleanup],
  });
});

it('does not report success when temporary server cleanup fails', async () => {
  const cleanup = new Error('server still running');
  stopAsync.mockRejectedValue(cleanup);
  await expect(bootResidentIosSimulatorAsync({ udid, env, logger })).rejects.toBe(cleanup);
});

it('keeps the server until setup finishes and cleans up when readiness fails', async () => {
  const error = new Error('device disappeared during readiness');
  jest.mocked(IosSimulatorUtils.waitForReadyAsync).mockRejectedValue(error);
  await expect(bootResidentIosSimulatorAsync({ udid, env, logger })).rejects.toBe(error);
  expect(runServeSimActionWithResultAsync).not.toHaveBeenCalled();
  expect(stopAsync).toHaveBeenCalledTimes(1);
});

it('cancels setup and stops its server without admitting a late result', async () => {
  const controller = new AbortController();
  const stopped = new Error('job stopped during setup');
  let rejectSetup!: (error: Error) => void;
  jest.mocked(IosSimulatorUtils.waitForReadyAsync).mockImplementation(
    () =>
      new Promise((_resolve, reject) => {
        rejectSetup = reject;
        controller.abort(stopped);
      })
  );
  await expect(
    bootResidentIosSimulatorAsync({ udid, env, logger, signal: controller.signal })
  ).rejects.toBe(stopped);
  expect(stopAsync).toHaveBeenCalledTimes(1);
  rejectSetup(new Error('late readiness failure'));
  await new Promise(resolve => setImmediate(resolve));
  expect(runServeSimActionWithResultAsync).not.toHaveBeenCalled();
});

it('releases the server when cancellation arrives after admission', async () => {
  const controller = new AbortController();
  const stopped = new Error('job stopped');
  jest.mocked(waitForServeSimControlAsync).mockImplementationOnce(async () => {
    controller.abort(stopped);
    return 'private-token';
  });
  await expect(
    bootResidentIosSimulatorAsync({ udid, env, logger, signal: controller.signal })
  ).rejects.toBe(stopped);
  expect(stopAsync).toHaveBeenCalledTimes(1);
});
