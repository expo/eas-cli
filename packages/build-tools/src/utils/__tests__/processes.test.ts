import { isChildProcessAlive } from '../processes';

describe(isChildProcessAlive, () => {
  it('is alive while the process is running', () => {
    expect(isChildProcessAlive({ exitCode: null, signalCode: null, killed: false })).toBe(true);
  });

  it('is dead after a normal exit', () => {
    expect(isChildProcessAlive({ exitCode: 0, signalCode: null, killed: false })).toBe(false);
    expect(isChildProcessAlive({ exitCode: 1, signalCode: null, killed: false })).toBe(false);
  });

  it('is dead after an external signal termination (the regression case)', () => {
    expect(isChildProcessAlive({ exitCode: null, signalCode: 'SIGTERM', killed: false })).toBe(
      false
    );
    expect(isChildProcessAlive({ exitCode: null, signalCode: 'SIGKILL', killed: false })).toBe(
      false
    );
  });

  it('is dead once we have killed it, and when there is no process', () => {
    expect(isChildProcessAlive({ exitCode: null, signalCode: null, killed: true })).toBe(false);
    expect(isChildProcessAlive(null)).toBe(false);
    expect(isChildProcessAlive(undefined)).toBe(false);
  });
});
