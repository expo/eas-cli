import { isProcessGroupRunning, isProcessRunning } from '../processes';

describe(isProcessRunning, () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('signals the process, not its group', () => {
    const kill = jest.spyOn(process, 'kill').mockReturnValue(true);
    expect(isProcessRunning(4321)).toBe(true);
    expect(kill).toHaveBeenCalledWith(4321, 0);
  });

  it('is not running once the process is gone', () => {
    jest.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('No such process'), { code: 'ESRCH' });
    });
    expect(isProcessRunning(4321)).toBe(false);
  });

  it('is running when the process exists but cannot be signaled', () => {
    jest.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('Operation not permitted'), { code: 'EPERM' });
    });
    expect(isProcessRunning(4321)).toBe(true);
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
