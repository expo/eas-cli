import { type ChildProcess, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

jest.mock('node:child_process', () => ({ spawn: jest.fn() }));
let commands: typeof import('../utils/processes').commands;
let stopProcessAndDescendantsAsync: typeof import('../utils/processes').stopProcessAndDescendantsAsync;
let terminateProcessGroupAsync: typeof import('../utils/processes').terminateProcessGroupAsync;
let child: ChildProcess;

beforeEach(() => {
  jest.useFakeTimers();
  jest.isolateModules(() => {
    ({
      commands,
      stopProcessAndDescendantsAsync,
      terminateProcessGroupAsync,
    } = require('../utils/processes'));
  });
  child = Object.assign(new EventEmitter(), {
    pid: 90001,
    exitCode: null,
    signalCode: null,
    stdout: new PassThrough(),
    kill: jest.fn().mockReturnValue(true),
    unref: jest.fn(),
  }) as unknown as ChildProcess;
  jest.mocked(spawn).mockReturnValue(child);
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test('captures output and waits for close rather than wrapper exit', async () => {
  const job = commands.start('command', [], undefined, true);
  let finished = false;
  const result = job.resultPromise.then(output => {
    finished = true;
    return output;
  });
  expect(child.listenerCount('close')).toBe(1);
  child.stdout!.emit('data', Buffer.from('output'));
  child.emit('exit', 0, null);
  await Promise.resolve();
  expect(finished).toBe(false);
  child.emit('close', 0, null);
  await expect(result).resolves.toBe('output');
  expect(() => commands.throwIfCommandCloseTimedOut()).not.toThrow();
});

for (const code of ['ABORT_ERR', 'ENOENT']) {
  test(`preserves original ${code} error and observes close before awaiting`, async () => {
    const error = Object.assign(new Error('original failure'), { code });
    const job = commands.start('command', []);
    let finished = false;
    const result = job.resultPromise.catch(error => {
      finished = true;
      return error;
    });
    expect(child.listenerCount('close')).toBe(1);
    child.emit('error', error);
    await Promise.resolve();
    expect(finished).toBe(false);
    child.emit('close', null, null);
    await expect(result).resolves.toBe(error);
  });
}

test('nonzero exits reject only after close and retain exit code', async () => {
  const job = commands.start('command', []);
  const result = job.resultPromise.catch(error => error);
  child.emit('exit', 7, null);
  child.emit('close', 7, null);
  expect((await result).code).toBe(7);
});

for (const event of ['error', 'exit']) {
  test(`bounded close drain fails teardown even after late close: ${event}`, async () => {
    const original = new Error('original abort');
    const job = commands.start('command', []);
    const result = job.resultPromise.catch(error => error);
    if (event === 'error') {
      child.emit('error', original);
    } else {
      child.emit('exit', 0, null);
    }
    await jest.advanceTimersByTimeAsync(130_000);
    const failure = await result;
    if (event === 'error') {
      expect(failure).toBe(original);
    } else {
      expect(failure.message).toContain('did not finish closing');
    }
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(child.unref).toHaveBeenCalled();
    expect(() => commands.throwIfCommandCloseTimedOut()).toThrow('did not finish closing');
    child.emit('close', 0, null);
    expect(() => commands.throwIfCommandCloseTimedOut()).toThrow('did not finish closing');
  });
}

test('descendants drain before their parent, then the owned child close is awaited', async () => {
  const alive = new Set([90001, 90002]);
  const signals: number[] = [];
  jest
    .mocked(child.kill)
    .mockImplementation(signal => process.kill(child.pid!, signal ?? 'SIGTERM'));
  jest.spyOn(process, 'kill').mockImplementation((pid, signal) => {
    if (!alive.has(pid)) {
      throw Object.assign(new Error('gone'), { code: 'ESRCH' });
    }
    if (signal === 'SIGTERM') {
      signals.push(pid);
      alive.delete(pid);
    }
    return true;
  });
  jest
    .spyOn(commands, 'runAsync')
    .mockImplementation(async (file, args) =>
      file === 'pgrep' && args[1] === '90001' ? '90002\n' : ''
    );
  let closed!: () => void;
  const resultPromise = new Promise<string>(resolve => {
    closed = () => resolve('');
  });
  let finished = false;
  const stopping = stopProcessAndDescendantsAsync({ child, resultPromise }).then(() => {
    finished = true;
  });
  await jest.advanceTimersByTimeAsync(1);
  expect(signals).toEqual([90002, 90001]);
  expect(finished).toBe(false);
  closed();
  await stopping;
  expect(finished).toBe(true);
});

test('an exited foreground wrapper is failed teardown; never inspect its possibly reused PID', async () => {
  Object.defineProperty(child, 'exitCode', { value: 0 });
  const kill = jest.spyOn(process, 'kill');
  await expect(
    stopProcessAndDescendantsAsync({ child, resultPromise: Promise.resolve('') })
  ).rejects.toThrow('child processes');
  expect(kill).not.toHaveBeenCalled();
  await expect(
    stopProcessAndDescendantsAsync({ child, resultPromise: Promise.resolve('') }, true)
  ).resolves.toBeUndefined();
});

test('a descendant that ignores TERM prevents stop success at the deadline', async () => {
  jest.spyOn(process, 'kill').mockImplementation((_pid, signal) => {
    if (signal === 'SIGTERM') {
      Object.defineProperty(child, 'exitCode', { value: 0 });
    }
    return true;
  });
  jest
    .spyOn(commands, 'runAsync')
    .mockImplementation(async (file, args) =>
      file === 'pgrep' ? (args[1] === '90001' ? '90002' : '') : 'S'
    );
  const result = stopProcessAndDescendantsAsync({
    child,
    resultPromise: Promise.resolve(''),
  }).catch(error => error);
  await jest.advanceTimersByTimeAsync(130_100);
  expect((await result).message).toContain('90002 is still running');
  expect(jest.mocked(process.kill).mock.calls.filter(([, signal]) => signal === 'SIGTERM')).toEqual(
    [[90002, 'SIGTERM']]
  );
});

test('ps failure cannot fabricate descendant teardown', async () => {
  jest.spyOn(process, 'kill').mockReturnValue(true);
  jest.spyOn(commands, 'runAsync').mockImplementation(async file => {
    if (file === 'pgrep') {
      return '';
    }
    throw new Error('ps failed');
  });
  await expect(
    stopProcessAndDescendantsAsync({ child, resultPromise: Promise.resolve('') })
  ).rejects.toThrow('ps failed');
});

test('normal wrapper exit during drain still drains every known child and awaits owned close without probing its reused PID', async () => {
  const job = commands.start('wrapper', []);
  const signals: number[] = [];
  jest.spyOn(process, 'kill').mockImplementation((pid, signal) => {
    if (pid === child.pid) {
      throw new Error('Possibly reused wrapper PID must not be probed or signalled.');
    }
    if (signal === 'SIGTERM') {
      signals.push(pid);
      Object.defineProperty(child, 'exitCode', { value: 0 });
      child.emit('exit', 0, null);
      return true;
    }
    if (signals.includes(pid)) {
      throw Object.assign(new Error('gone'), { code: 'ESRCH' });
    }
    return true;
  });
  jest
    .spyOn(commands, 'runAsync')
    .mockImplementation(async (file, args) =>
      file === 'pgrep' && args[1] === '90001' ? '90002\n90003' : ''
    );
  let finished = false;
  const stopping = stopProcessAndDescendantsAsync(job).then(() => {
    finished = true;
  });
  await jest.advanceTimersByTimeAsync(1);
  expect(signals).toEqual([90002, 90003]);
  expect(child.kill).not.toHaveBeenCalled();
  expect(finished).toBe(false);
  child.emit('close', 0, null);
  await stopping;
  expect(finished).toBe(true);
});

test('wrapper exit before completed descendant discovery fails without inspecting discovered PIDs', async () => {
  const kill = jest.spyOn(process, 'kill');
  jest.spyOn(commands, 'runAsync').mockImplementation(async () => {
    Object.defineProperty(child, 'exitCode', { value: 0 });
    return '90002';
  });
  await expect(
    stopProcessAndDescendantsAsync({ child, resultPromise: Promise.resolve('') })
  ).rejects.toThrow('before its child processes could be identified');
  expect(commands.runAsync).toHaveBeenCalledTimes(1);
  expect(kill).not.toHaveBeenCalled();
  expect(child.kill).not.toHaveBeenCalled();
});

test.each([
  { exitCode: 1, signalCode: null },
  { exitCode: null, signalCode: 'SIGTERM' },
])('unexpected wrapper exit during drain fails closed: %j', async exit => {
  const signals: number[] = [];
  jest.spyOn(process, 'kill').mockImplementation((pid, signal) => {
    if (signal === 'SIGTERM') {
      signals.push(pid);
      Object.assign(child, exit);
    }
    if (!signal && signals.includes(pid)) {
      throw Object.assign(new Error('gone'), { code: 'ESRCH' });
    }
    return true;
  });
  jest
    .spyOn(commands, 'runAsync')
    .mockImplementation(async (file, args) =>
      file === 'pgrep' && args[1] === '90001' ? '90002' : ''
    );
  await expect(
    stopProcessAndDescendantsAsync({ child, resultPromise: Promise.resolve('') })
  ).rejects.toThrow('exited unexpectedly while its child processes were stopping');
  expect(signals).toEqual([90002]);
  expect(child.kill).not.toHaveBeenCalled();
});

test('normal wrapper exit after draining does not bypass a missing close timeout', async () => {
  const job = commands.start('wrapper', []);
  let descendantAlive = true;
  jest.spyOn(process, 'kill').mockImplementation((pid, signal) => {
    if (pid !== 90002) {
      throw new Error('Possibly reused wrapper PID must not be probed or signalled.');
    }
    if (signal === 'SIGTERM') {
      descendantAlive = false;
      Object.defineProperty(child, 'exitCode', { value: 0 });
      child.emit('exit', 0, null);
    } else if (!descendantAlive) {
      throw Object.assign(new Error('gone'), { code: 'ESRCH' });
    }
    return true;
  });
  jest
    .spyOn(commands, 'runAsync')
    .mockImplementation(async (file, args) =>
      file === 'pgrep' && args[1] === '90001' ? '90002' : ''
    );
  const stopping = stopProcessAndDescendantsAsync(job).catch(error => error);
  await jest.advanceTimersByTimeAsync(130_001);
  expect((await stopping).message).toContain('did not finish closing');
  child.emit('close', 0, null);
  expect(() => commands.throwIfCommandCloseTimedOut()).toThrow('did not finish closing');
});

describe('terminateProcessGroupAsync', () => {
  /** Models the group led by 90001; `members` are its live processes. */
  function group(members: Set<number>, { ignoresTerm = false, survivesKill = false } = {}) {
    const signals: [number, string | number | undefined][] = [];
    jest.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (pid !== -90001) {
        throw new Error(`Only the process group may be signalled, not ${pid}.`);
      }
      if (members.size === 0) {
        throw Object.assign(new Error('gone'), { code: 'ESRCH' });
      }
      if (signal) {
        signals.push([pid, signal]);
      }
      if ((signal === 'SIGTERM' && !ignoresTerm) || (signal === 'SIGKILL' && !survivesKill)) {
        members.clear();
      }
      return true;
    });
    return signals;
  }

  it('signals the whole group once and waits for it to empty', async () => {
    const signals = group(new Set([90001, 90002, 90003]));
    await terminateProcessGroupAsync({ child, resultPromise: Promise.resolve('') });
    expect(signals).toEqual([[-90001, 'SIGTERM']]);
  });

  it('kills a group that ignores TERM after the grace period', async () => {
    jest.useRealTimers();
    const signals = group(new Set([90001, 90004]), { ignoresTerm: true });
    await terminateProcessGroupAsync({ child, resultPromise: Promise.resolve('') }, 50);
    expect(signals).toEqual([
      [-90001, 'SIGTERM'],
      [-90001, 'SIGKILL'],
    ]);
  });

  it('fails when the group survives SIGKILL', async () => {
    jest.useRealTimers();
    group(new Set([90001, 90004]), { ignoresTerm: true, survivesKill: true });
    const stopping = terminateProcessGroupAsync(
      { child, resultPromise: Promise.resolve('') },
      50
    ).catch(error => error);
    expect((await stopping).message).toContain('process group 90001 is still running');
  });

  it('never signals a reused PID after its group has exited', async () => {
    jest.useRealTimers();
    const members = new Set([90001, 90002]);
    const signals = group(members);
    const groupKill = jest.mocked(process.kill).getMockImplementation()!;
    // After TERM empties the group, 90001's number belongs to an unrelated live process.
    jest
      .mocked(process.kill)
      .mockImplementation((pid, signal) => (pid === 90001 ? true : groupKill(pid, signal)));
    await terminateProcessGroupAsync({ child, resultPromise: Promise.resolve('') }, 50);
    expect(signals).toEqual([[-90001, 'SIGTERM']]);
    expect(jest.mocked(process.kill).mock.calls.some(([pid]) => pid > 0)).toBe(false);
  });
});

test('serve-sim leads its own process group', () => {
  const { startServeSim } = require('../utils/serveSim');
  startServeSim('PHONE', new AbortController().signal);
  expect(spawn).toHaveBeenCalledWith(
    'bunx',
    expect.arrayContaining(['PHONE', '--port', '3200']),
    expect.objectContaining({ detached: true })
  );
});

test('the fixture PID guard keeps tests away from the real process.kill', () => {
  expect(() => process.kill(90002, 0)).toThrow('fixture PID 90002');
  expect(() => process.kill(-90001, 'SIGKILL')).toThrow('fixture PID -90001');
  expect(() => process.kill(11, 0)).toThrow('fixture PID 11');
});
