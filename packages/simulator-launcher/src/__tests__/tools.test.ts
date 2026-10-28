import { type ChildProcess } from 'node:child_process';

import { createAgentDeviceTool } from '../utils/agentDevice';
import { commands, stopProcessAndDescendantsAsync } from '../utils/processes';
import { type WarmTool, startTool } from '../utils/tools';
import { deferred } from './helpers';

jest.mock('../utils/processes');

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(commands.runAsync).mockResolvedValue('');
  jest.mocked(stopProcessAndDescendantsAsync).mockResolvedValue();
});

it('prepares at once, starts after serve-sim, and reports a failure before cancellation', async () => {
  const serveSimReady = deferred();
  const failure = new Error('start failed');
  const tool: WarmTool = {
    name: 'argent',
    prepareAsync: jest.fn(async () => {}),
    startAsync: jest.fn(async () => {
      throw failure;
    }),
    stopAsync: jest.fn(async () => {}),
  };
  const onFailure = jest.fn();
  const started = startTool(
    tool,
    'PHONE',
    serveSimReady.promise,
    new AbortController().signal,
    onFailure
  );
  expect(tool.prepareAsync).toHaveBeenCalledTimes(1);
  await new Promise(resolve => setImmediate(resolve));
  expect(tool.startAsync).not.toHaveBeenCalled();
  serveSimReady.resolve();
  await expect(started.ready).rejects.toBe(failure);
  expect(tool.startAsync).toHaveBeenCalledWith('PHONE', expect.any(AbortSignal));
  expect(onFailure).toHaveBeenCalledWith(failure);
});

it('stops agent-device mid-prepare without reporting it, and stops the daemon', async () => {
  const preparing = deferred<string>();
  const prepare = { child: { pid: 11 } as ChildProcess, resultPromise: preparing.promise };
  jest.mocked(commands.start).mockReturnValue(prepare);
  const onFailure = jest.fn();
  const started = startTool(
    createAgentDeviceTool(),
    'PHONE',
    Promise.resolve(),
    new AbortController().signal,
    onFailure
  );
  try {
    await new Promise(resolve => setImmediate(resolve));
    expect(commands.start).toHaveBeenCalledTimes(1);
    expect(commands.start).toHaveBeenCalledWith(
      'bunx',
      expect.arrayContaining(['prepare', 'ios-runner']),
      undefined,
      false,
      true
    );
    // The prepare process is still running; the stop does not wait for it to exit by itself.
    await started.stopAsync();
    expect(stopProcessAndDescendantsAsync).toHaveBeenCalledWith(prepare, true);
    expect(commands.runAsync).toHaveBeenCalledWith(
      'bunx',
      expect.arrayContaining(['daemon', 'stop'])
    );
    expect(onFailure).not.toHaveBeenCalled();
  } finally {
    preparing.resolve('');
  }
});

it('stops the agent-device daemon even when the prepare process cannot be stopped', async () => {
  const prepare = { child: { pid: 11 } as ChildProcess, resultPromise: Promise.resolve('') };
  const failure = new Error('prepare stop failed');
  jest.mocked(commands.start).mockReturnValue(prepare);
  jest.mocked(stopProcessAndDescendantsAsync).mockRejectedValueOnce(failure);
  const tool = createAgentDeviceTool();
  await tool.startAsync('PHONE', new AbortController().signal);
  await expect(tool.stopAsync()).rejects.toBe(failure);
  expect(commands.runAsync).toHaveBeenCalledWith(
    'bunx',
    expect.arrayContaining(['daemon', 'stop'])
  );
  // The prepare process stays owned, so a later stop tries it again.
  await tool.stopAsync();
  expect(jest.mocked(stopProcessAndDescendantsAsync).mock.calls).toEqual([
    [prepare, true],
    [prepare, true],
  ]);
});

it('reports a synchronous prepare throw through ready instead of throwing from startTool', async () => {
  const failure = new Error('prepare threw');
  const tool: WarmTool = {
    name: 'argent',
    prepareAsync: () => {
      throw failure;
    },
    startAsync: jest.fn(async () => {}),
    stopAsync: jest.fn(async () => {}),
  };
  const onFailure = jest.fn();
  const started = startTool(
    tool,
    'PHONE',
    Promise.resolve(),
    new AbortController().signal,
    onFailure
  );
  await expect(started.ready).rejects.toBe(failure);
  expect(tool.startAsync).not.toHaveBeenCalled();
  expect(onFailure).toHaveBeenCalledWith(failure);
});

it('keeps both errors when the agent-device prepare and daemon stops fail', async () => {
  const prepare = { child: { pid: 11 } as ChildProcess, resultPromise: Promise.resolve('') };
  const prepareFailure = new Error('prepare stop failed');
  const daemonFailure = new Error('daemon stop failed');
  jest.mocked(commands.start).mockReturnValue(prepare);
  jest.mocked(stopProcessAndDescendantsAsync).mockRejectedValueOnce(prepareFailure);
  jest.mocked(commands.runAsync).mockRejectedValueOnce(daemonFailure);
  const tool = createAgentDeviceTool();
  await tool.startAsync('PHONE', new AbortController().signal);
  await expect(tool.stopAsync()).rejects.toMatchObject({ errors: [prepareFailure, daemonFailure] });
});

it('drains independent tool preparation after serve-sim readiness rejects', async () => {
  const prepared = deferred();
  const failure = new Error('serve-sim readiness failed');
  const tool: WarmTool = {
    name: 'argent',
    prepareAsync: () => prepared.promise,
    startAsync: jest.fn(async () => {}),
    stopAsync: jest.fn(async () => {}),
  };
  const started = startTool(
    tool,
    'PHONE',
    Promise.reject(failure),
    new AbortController().signal,
    jest.fn()
  );
  await expect(started.ready).rejects.toBe(failure);
  let stopped = false;
  const stopping = started.stopAsync().then(() => {
    stopped = true;
  });
  await new Promise(resolve => setImmediate(resolve));
  expect(stopped).toBe(false);
  expect(tool.stopAsync).not.toHaveBeenCalled();
  prepared.resolve();
  await stopping;
  expect(tool.startAsync).not.toHaveBeenCalled();
  expect(tool.stopAsync).toHaveBeenCalledTimes(1);
});
