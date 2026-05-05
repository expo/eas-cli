import resolveFrom from 'resolve-from';
import spawnAsync from '@expo/turtle-spawn';

import { expoCommandAsync, ExpoCLIModuleNotFoundError } from '../expoCli';

jest.mock('resolve-from', () => ({
  __esModule: true,
  default: Object.assign(jest.fn(), {
    silent: jest.fn(),
  }),
}));

jest.mock('@expo/turtle-spawn', () => ({
  __esModule: true,
  default: jest.fn().mockResolvedValue({ stdout: '', stderr: '' }),
}));

const mockedResolveFrom = resolveFrom as jest.MockedFunction<typeof resolveFrom> & {
  silent: jest.MockedFunction<typeof resolveFrom.silent>;
};

describe(expoCommandAsync, () => {
  it('resolves expo CLI and spawns with correct args', async () => {
    mockedResolveFrom.silent.mockReturnValue('/project/node_modules/expo/bin/cli');

    await expoCommandAsync('/project', ['config', '--json'], { env: { FOO: 'bar' } });

    expect(spawnAsync).toHaveBeenCalledWith(
      '/project/node_modules/expo/bin/cli',
      ['config', '--json'],
      expect.objectContaining({
        cwd: '/project',
        stdio: 'pipe',
        env: { FOO: 'bar', EXPO_DEBUG: '0' },
      })
    );
  });

  it('falls back to expo/bin/cli.js when silent resolve returns null', async () => {
    mockedResolveFrom.silent.mockReturnValue(undefined);
    mockedResolveFrom.mockReturnValue('/project/node_modules/expo/bin/cli.js');

    await expoCommandAsync('/project', ['config'], { env: {} });

    expect(spawnAsync).toHaveBeenCalledWith(
      '/project/node_modules/expo/bin/cli.js',
      ['config'],
      expect.any(Object)
    );
  });

  it('throws ExpoCLIModuleNotFoundError when expo is not installed', async () => {
    mockedResolveFrom.silent.mockReturnValue(undefined);
    const moduleError = new Error('Cannot find module');
    (moduleError as any).code = 'MODULE_NOT_FOUND';
    mockedResolveFrom.mockImplementation(() => {
      throw moduleError;
    });

    await expect(expoCommandAsync('/project', ['config'], { env: {} })).rejects.toThrow(
      ExpoCLIModuleNotFoundError
    );
  });

  it('overrides EXPO_DEBUG to 0', async () => {
    mockedResolveFrom.silent.mockReturnValue('/project/node_modules/expo/bin/cli');

    await expoCommandAsync('/project', ['config'], { env: { EXPO_DEBUG: '1' } });

    expect(spawnAsync).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({
        env: expect.objectContaining({ EXPO_DEBUG: '0' }),
      })
    );
  });
});
