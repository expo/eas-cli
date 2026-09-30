import { SystemError } from '@expo/eas-build-job';
import spawn from '@expo/turtle-spawn';

import { getXcodeVersionAsync } from '../xcode';

jest.mock('@expo/turtle-spawn', () => ({
  __esModule: true,
  default: jest.fn(),
}));

const mockedSpawn = jest.mocked(spawn);

describe(getXcodeVersionAsync, () => {
  it('returns the Xcode version', async () => {
    mockedSpawn.mockResolvedValue({
      stdout: 'Xcode 26.0\nBuild version 17A324\n',
    } as any);

    await expect(getXcodeVersionAsync({ env: process.env })).resolves.toBe('26.0');
    expect(mockedSpawn).toHaveBeenCalledWith('xcodebuild', ['-version'], {
      stdio: 'pipe',
      env: process.env,
    });
  });

  it('throws when the Xcode version cannot be parsed', async () => {
    mockedSpawn.mockResolvedValue({ stdout: 'unexpected output' } as any);

    await expect(getXcodeVersionAsync({ env: process.env })).rejects.toThrow(
      'Failed to determine Xcode version'
    );
  });

  it('wraps errors from xcodebuild in a SystemError', async () => {
    const cause = new Error('xcode-select: error: invalid developer directory');
    mockedSpawn.mockRejectedValue(cause);

    const promise = getXcodeVersionAsync({ env: process.env });

    await expect(promise).rejects.toBeInstanceOf(SystemError);
    await expect(promise).rejects.toMatchObject({
      message: 'Failed to get Xcode version',
      cause,
    });
  });
});
