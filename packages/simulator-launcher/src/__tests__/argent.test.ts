import { type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';

import { createArgentTool } from '../utils/argent';
import {
  commands,
  isProcessOwnedByServiceAsync,
  stopProcessAndDescendantsAsync,
} from '../utils/processes';
import { type WarmTool } from '../utils/tools';
import { deferred, until } from './helpers';

jest.mock('node:fs/promises');
jest.mock('../utils/processes');
let child: ChildProcess;
let result: ReturnType<typeof deferred<string>>;
let controller: AbortController;
let onFailure: jest.Mock;
let tool: WarmTool;

beforeEach(() => {
  jest.resetAllMocks();
  child = Object.assign(new EventEmitter(), {
    pid: 90001,
    exitCode: null,
    signalCode: null,
  }) as ChildProcess;
  result = deferred<string>();
  void result.promise.catch(() => {});
  controller = new AbortController();
  onFailure = jest.fn();
  // The old factory ignores this callback; its start also resolves without readiness.
  const createTool: (onFailure: (error: unknown) => void) => WarmTool = createArgentTool;
  tool = createTool(onFailure);
  jest.mocked(commands.start).mockReturnValue({ child, resultPromise: result.promise });
  jest.mocked(isProcessOwnedByServiceAsync).mockResolvedValue(true);
  jest.mocked(fs.readdir).mockResolvedValue(['tool-server.json'] as never);
  jest
    .mocked(fs.readFile)
    .mockResolvedValue(JSON.stringify({ pid: 90001, port: 3201, token: 'fixture-token' }));
  jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({ tools: [] })));
  jest.mocked(stopProcessAndDescendantsAsync).mockResolvedValue();
});
afterEach(() => {
  controller.abort();
  jest.restoreAllMocks();
});

it('does not report ready until its owned server answers the authenticated tools request', async () => {
  const response = deferred<Response>();
  jest.mocked(fetch).mockReturnValue(response.promise);
  let ready = false;
  const started = tool.startAsync('PHONE', controller.signal).then(() => {
    ready = true;
  });
  await until(() => jest.mocked(fetch).mock.calls.length > 0 || ready);
  expect(ready).toBe(false);
  response.resolve(new Response(JSON.stringify({ tools: [] })));
  await started;
  expect(commands.start).toHaveBeenCalledWith(
    'bunx',
    expect.arrayContaining(['server', 'start']),
    undefined,
    false,
    true
  );
  expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:3201/tools', {
    headers: { Authorization: 'Bearer fixture-token' },
    signal: expect.any(AbortSignal),
  });
});

it('rejects an exit during the readiness request, even before the wrapper finishes closing', async () => {
  const response = deferred<Response>();
  jest.mocked(fetch).mockReturnValue(response.promise);
  const started = tool.startAsync('PHONE', controller.signal);
  await until(() => jest.mocked(fetch).mock.calls.length > 0);
  Object.assign(child, { exitCode: 1 });
  child.emit('exit', 1, null);
  response.resolve(new Response(JSON.stringify({ tools: [] })));
  await expect(started).rejects.toThrow('Argent exited before its server became ready');
  expect(onFailure).not.toHaveBeenCalled();
});

it('observes an unexpected exit after readiness exactly once', async () => {
  await tool.startAsync('PHONE', controller.signal);
  child.emit('exit', 1, null);
  result.reject(new Error('wrapper failed'));
  await Promise.resolve();
  expect(onFailure).toHaveBeenCalledTimes(1);
  expect(onFailure.mock.calls[0][0].message).toContain('Argent server exited unexpectedly');
});

it('ignores a foreign state file without sending its token to the local port', async () => {
  jest.mocked(isProcessOwnedByServiceAsync).mockResolvedValue(false);
  const started = tool.startAsync('PHONE', controller.signal).catch(error => error);
  await until(() => jest.mocked(isProcessOwnedByServiceAsync).mock.calls.length > 0);
  expect(fetch).not.toHaveBeenCalled();
  controller.abort(new Error('cancelled'));
  expect((await started).code).toBe('ABORT_ERR');
});

it('retries an invalid tools response and does not notify for intentional stop', async () => {
  jest
    .mocked(fetch)
    .mockResolvedValueOnce(new Response('{}'))
    .mockImplementation(async () => new Response(JSON.stringify({ tools: [] })));
  await tool.startAsync('PHONE', controller.signal);
  expect(fetch).toHaveBeenCalledTimes(2);
  jest.mocked(stopProcessAndDescendantsAsync).mockImplementation(async () => {
    child.emit('exit', 0, null);
  });
  await tool.stopAsync();
  expect(onFailure).not.toHaveBeenCalled();
});

it('does not notify for cancelled tool teardown', async () => {
  await tool.startAsync('PHONE', controller.signal);
  controller.abort();
  child.emit('exit', 0, null);
  expect(onFailure).not.toHaveBeenCalled();
});

it('never publishes ready when cancellation arrives during the tools request', async () => {
  const response = deferred<Response>();
  jest.mocked(fetch).mockReturnValue(response.promise);
  const started = tool.startAsync('PHONE', controller.signal);
  await until(() => jest.mocked(fetch).mock.calls.length > 0);
  controller.abort(new Error('cancelled'));
  response.resolve(new Response(JSON.stringify({ tools: [] })));
  await expect(started).rejects.toThrow('cancelled');
  expect(onFailure).not.toHaveBeenCalled();
});

it('bounds readiness when the server never becomes available', async () => {
  const now = Date.now();
  jest
    .spyOn(Date, 'now')
    .mockReturnValueOnce(now)
    .mockReturnValue(now + 120_000);
  await expect(tool.startAsync('PHONE', controller.signal)).rejects.toThrow(
    'Timed out waiting for the Argent server'
  );
  expect(fetch).not.toHaveBeenCalled();
});

it('retries missing or incomplete state and transient HTTP failures before becoming ready', async () => {
  jest
    .mocked(fs.readdir)
    .mockRejectedValueOnce(
      Object.assign(new Error('state directory not written yet'), { code: 'ENOENT' })
    )
    .mockResolvedValue(['events.jsonl', 'tool-server-old.json', 'tool-server.json'] as never);
  jest
    .mocked(fs.readFile)
    .mockRejectedValueOnce(new Error('state disappeared during startup'))
    .mockResolvedValue(JSON.stringify({ pid: 90001, port: 3201, token: 'fixture-token' }));
  jest
    .mocked(fetch)
    .mockRejectedValueOnce(new Error('connection refused'))
    .mockResolvedValueOnce(new Response('unauthorized', { status: 401 }))
    .mockImplementation(async () => new Response(JSON.stringify({ tools: [] })));
  await tool.startAsync('PHONE', controller.signal);
  expect(fs.readdir).toHaveBeenCalledTimes(3);
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(onFailure).not.toHaveBeenCalled();
});

it('rejects a successful wrapper exit while no state directory is available', async () => {
  jest.mocked(fs.readdir).mockImplementation(async () => {
    result.resolve('');
    throw new Error('state directory unavailable');
  });
  await expect(tool.startAsync('PHONE', controller.signal)).rejects.toThrow(
    'Argent exited before its server became ready'
  );
  expect(fetch).not.toHaveBeenCalled();
  expect(onFailure).not.toHaveBeenCalled();
});

it('rejects an exit during the final ownership check before publishing readiness', async () => {
  const owned = deferred<boolean>();
  jest
    .mocked(isProcessOwnedByServiceAsync)
    .mockResolvedValueOnce(true)
    .mockReturnValue(owned.promise);
  const started = tool.startAsync('PHONE', controller.signal);
  await until(() => jest.mocked(isProcessOwnedByServiceAsync).mock.calls.length === 2);
  child.emit('error', new Error('server failed during validation'));
  owned.resolve(true);
  await expect(started).rejects.toThrow('Argent exited before its server became ready');
  expect(onFailure).not.toHaveBeenCalled();
});
