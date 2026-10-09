import Log from '../log';

describe(Log.errorToStderr, () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('writes to stderr, not stdout', () => {
    const stdout = jest.spyOn(console, 'log').mockImplementation(() => {});
    const stderr = jest.spyOn(console, 'error').mockImplementation(() => {});

    Log.errorToStderr('EAS project not configured.');

    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('EAS project not configured.'));
    expect(stdout).not.toHaveBeenCalled();
  });
});
