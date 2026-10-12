import { ChildProcess, spawn } from 'node:child_process';
import { once } from 'node:events';

import { isChildProcessAlive, isProcessGroupRunning, killProcesses } from '../processes';

function child(partial: {
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  killed: boolean;
}): ChildProcess {
  return partial as ChildProcess;
}

describe(isChildProcessAlive, () => {
  it('is alive while the process is running', () => {
    expect(isChildProcessAlive(child({ exitCode: null, signalCode: null, killed: false }))).toBe(
      true
    );
  });

  it('is dead after a normal exit', () => {
    expect(isChildProcessAlive(child({ exitCode: 0, signalCode: null, killed: false }))).toBe(
      false
    );
    expect(isChildProcessAlive(child({ exitCode: 1, signalCode: null, killed: false }))).toBe(
      false
    );
  });

  it('is dead after an external signal termination (the regression case)', () => {
    expect(
      isChildProcessAlive(child({ exitCode: null, signalCode: 'SIGTERM', killed: false }))
    ).toBe(false);
    expect(
      isChildProcessAlive(child({ exitCode: null, signalCode: 'SIGKILL', killed: false }))
    ).toBe(false);
  });

  it('is dead once we have killed it', () => {
    expect(isChildProcessAlive(child({ exitCode: null, signalCode: null, killed: true }))).toBe(
      false
    );
  });
});

describe(isProcessGroupRunning, () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('signals the group, not the leader', () => {
    const kill = jest.spyOn(process, 'kill').mockReturnValue(true);
    expect(isProcessGroupRunning(4321)).toBe(true);
    expect(kill).toHaveBeenCalledWith(-4321, 0);
  });

  it('is not running once the group is gone', () => {
    jest.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('No such process'), { code: 'ESRCH' });
    });
    expect(isProcessGroupRunning(4321)).toBe(false);
  });

  it('is running when the group exists but cannot be signaled', () => {
    jest.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('Operation not permitted'), { code: 'EPERM' });
    });
    expect(isProcessGroupRunning(4321)).toBe(true);
  });
});

describe(killProcesses, () => {
  function errnoError(code: string): NodeJS.ErrnoException {
    const error: NodeJS.ErrnoException = new Error(`kill ${code}`);
    error.code = code;
    return error;
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('kills every pid with the given signal', () => {
    const killSpy = jest.spyOn(process, 'kill').mockImplementation(() => true);

    killProcesses([101, 102], 'SIGKILL');

    expect(killSpy.mock.calls).toEqual([
      [101, 'SIGKILL'],
      [102, 'SIGKILL'],
    ]);
  });

  it('ignores pids that already exited and keeps killing the rest', () => {
    const killSpy = jest.spyOn(process, 'kill').mockImplementation(pid => {
      if (pid === 101) {
        throw errnoError('ESRCH');
      }
      return true;
    });

    expect(() => {
      killProcesses([101, 102]);
    }).not.toThrow();
    expect(killSpy.mock.calls).toEqual([
      [101, 'SIGTERM'],
      [102, 'SIGTERM'],
    ]);
  });

  it('does not throw for a real process that has already exited', async () => {
    const exited = spawn(process.execPath, ['-e', '']);
    await once(exited, 'exit');

    expect(() => {
      killProcesses([exited.pid!]);
    }).not.toThrow();
  });

  it('rethrows other errors', () => {
    jest.spyOn(process, 'kill').mockImplementation(() => {
      throw errnoError('EPERM');
    });

    expect(() => {
      killProcesses([101]);
    }).toThrow('kill EPERM');
  });
});
