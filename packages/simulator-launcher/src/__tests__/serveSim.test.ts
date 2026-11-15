import { type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';

import {
  type ChildProcessHandle,
  commands,
  isProcessOwnedByServiceAsync,
} from '../utils/processes';
import { waitForServeSimReadyAsync } from '../utils/serveSim';
import { deferred, until } from './helpers';

jest.mock('node:fs/promises');
jest.mock('../utils/processes');
let child: ChildProcess;
let server: ChildProcessHandle;
let controller: AbortController;
const state = {
  pid: 90002,
  port: 3202,
  device: 'PHONE',
  url: 'http://127.0.0.1:3202',
  token: 'fixture-token',
};
beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(commands.runAsync).mockResolvedValue('native-start');
  child = { pid: 90001, exitCode: null, signalCode: null } as ChildProcess;
  server = { child, resultPromise: new Promise<string>(() => {}) };
  controller = new AbortController();
  jest.mocked(fs.readFile).mockResolvedValue(JSON.stringify(state));
  jest.mocked(isProcessOwnedByServiceAsync).mockResolvedValue(true);
  jest
    .spyOn(global, 'fetch')
    .mockImplementation(
      async () => new Response(JSON.stringify({ status: 'ready', device: 'PHONE' }))
    );
});
afterEach(() => {
  controller.abort();
  jest.restoreAllMocks();
});

it('ignores a matching old server until the new launch owns the registered process', async () => {
  jest.mocked(isProcessOwnedByServiceAsync).mockResolvedValue(false);
  let ready = false;
  const waiting = waitForServeSimReadyAsync('PHONE', server, controller.signal, 3202).then(() => {
    ready = true;
  });
  await until(() => jest.mocked(fs.readFile).mock.calls.length > 0);
  await new Promise(resolve => setImmediate(resolve));
  expect(ready).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
  jest.mocked(isProcessOwnedByServiceAsync).mockResolvedValue(true);
  await waiting;
  expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:3202/readyz', {
    signal: expect.any(AbortSignal),
  });
});

it('rejects the launch exiting during a successful readiness response without waiting for close', async () => {
  const response = deferred<Response>();
  jest.mocked(fetch).mockReturnValue(response.promise);
  const waiting = waitForServeSimReadyAsync('PHONE', server, controller.signal, 3202);
  await until(() => jest.mocked(fetch).mock.calls.length > 0);
  Object.assign(child, { exitCode: 1 });
  response.resolve(new Response(JSON.stringify({ status: 'ready', device: 'PHONE' })));
  await expect(waiting).rejects.toThrow('serve-sim exited before PHONE became ready');
});

it('does not probe a state file without a process identity', async () => {
  jest.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ ...state, pid: undefined }));
  const waiting = waitForServeSimReadyAsync('PHONE', server, controller.signal, 3202).catch(
    error => error
  );
  await until(() => jest.mocked(fs.readFile).mock.calls.length > 0);
  await new Promise(resolve => setImmediate(resolve));
  expect(fetch).not.toHaveBeenCalled();
  expect(isProcessOwnedByServiceAsync).not.toHaveBeenCalled();
  controller.abort();
  expect((await waiting).code).toBe('ABORT_ERR');
});

it('cannot report ready after cancellation during the response', async () => {
  const response = deferred<Response>();
  jest.mocked(fetch).mockReturnValue(response.promise);
  const waiting = waitForServeSimReadyAsync('PHONE', server, controller.signal, 3202);
  await until(() => jest.mocked(fetch).mock.calls.length > 0);
  controller.abort(new Error('cancelled'));
  response.resolve(new Response(JSON.stringify({ status: 'ready', device: 'PHONE' })));
  await expect(waiting).rejects.toThrow('cancelled');
});

it('times out rather than accepting a server that never becomes ready', async () => {
  const now = Date.now();
  jest
    .spyOn(Date, 'now')
    .mockReturnValueOnce(now)
    .mockReturnValue(now + 120_000);
  await expect(waitForServeSimReadyAsync('PHONE', server, controller.signal, 3202)).rejects.toThrow(
    'Timed out waiting for serve-sim on PHONE'
  );
  expect(fetch).not.toHaveBeenCalled();
});

it('retries HTTP errors, a refused connection and readiness for another device', async () => {
  jest
    .mocked(fetch)
    .mockResolvedValueOnce(new Response('unavailable', { status: 503 }))
    .mockRejectedValueOnce(new Error('connection refused'))
    .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'ready', device: 'OTHER' })))
    .mockImplementation(
      async () => new Response(JSON.stringify({ status: 'ready', device: 'PHONE' }))
    );
  await waitForServeSimReadyAsync('PHONE', server, controller.signal, 3202);
  expect(fetch).toHaveBeenCalledTimes(4);
});
