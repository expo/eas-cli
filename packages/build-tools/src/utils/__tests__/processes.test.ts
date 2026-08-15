import { ChildProcess } from 'node:child_process';

import { isChildProcessAlive } from '../processes';

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
