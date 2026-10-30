import { type ChildProcess } from 'node:child_process';

import { commands, isProcessOwnedByServiceAsync } from '../utils/processes';
import { deferred } from './helpers';

let child: ChildProcess;
let controller: AbortController;
beforeEach(() => {
  child = { pid: 90001, exitCode: null, signalCode: null } as ChildProcess;
  controller = new AbortController();
  jest.spyOn(commands, 'runAsync');
});
afterEach(() => jest.restoreAllMocks());

it('accepts its live owned root without probing a PID', async () => {
  await expect(isProcessOwnedByServiceAsync(90001, child, controller.signal)).resolves.toBe(true);
  expect(commands.runAsync).not.toHaveBeenCalled();
});
it('walks a descendant to its owned root and rejects a foreign tree', async () => {
  jest.mocked(commands.runAsync).mockResolvedValueOnce('90003').mockResolvedValueOnce('90001');
  await expect(isProcessOwnedByServiceAsync(90002, child, controller.signal)).resolves.toBe(true);
  expect(commands.runAsync).toHaveBeenNthCalledWith(
    1,
    'ps',
    ['-p', '90002', '-o', 'ppid='],
    controller.signal
  );
  jest.mocked(commands.runAsync).mockResolvedValue('1');
  await expect(isProcessOwnedByServiceAsync(90004, child, controller.signal)).resolves.toBe(false);
});
it('rejects a root that exits during ancestry discovery without probing its reused PID', async () => {
  const parent = deferred<string>();
  jest.mocked(commands.runAsync).mockReturnValue(parent.promise);
  const owned = isProcessOwnedByServiceAsync(90002, child, controller.signal);
  Object.assign(child, { exitCode: 1 });
  parent.resolve('90001');
  await expect(owned).resolves.toBe(false);
  expect(commands.runAsync).toHaveBeenCalledTimes(1);
});
it('stops at a cycle, a gone process, or cancellation', async () => {
  jest.mocked(commands.runAsync).mockResolvedValue('90002');
  await expect(isProcessOwnedByServiceAsync(90002, child, controller.signal)).resolves.toBe(false);
  jest.mocked(commands.runAsync).mockRejectedValue(Object.assign(new Error('gone'), { code: 1 }));
  await expect(isProcessOwnedByServiceAsync(90002, child, controller.signal)).resolves.toBe(false);
  controller.abort(new Error('cancelled'));
  await expect(isProcessOwnedByServiceAsync(90001, child, controller.signal)).rejects.toThrow(
    'cancelled'
  );
});
it('preserves unexpected process-query failures', async () => {
  jest.mocked(commands.runAsync).mockRejectedValue(new Error('ps failed'));
  await expect(isProcessOwnedByServiceAsync(90002, child, controller.signal)).rejects.toThrow(
    'ps failed'
  );
});

it('bounds ancestry discovery even when every parent exists but none belongs to this service', async () => {
  let parent = 90100;
  jest.mocked(commands.runAsync).mockImplementation(async () => String(parent++));
  await expect(isProcessOwnedByServiceAsync(90002, child, controller.signal)).resolves.toBe(false);
  expect(commands.runAsync).toHaveBeenCalledTimes(32);
});
