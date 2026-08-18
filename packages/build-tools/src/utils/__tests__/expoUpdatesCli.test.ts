import { silent as silentResolveFrom } from 'resolve-from';
import spawnAsync from '@expo/turtle-spawn';

import { expoUpdatesCommandAsync } from '../expoUpdatesCli';

jest.mock('resolve-from', () => ({
  __esModule: true,
  default: jest.fn(),
  silent: jest.fn(),
}));

jest.mock('@expo/turtle-spawn', () => ({
  __esModule: true,
  default: jest.fn().mockResolvedValue({ stdout: '' }),
}));

describe(expoUpdatesCommandAsync, () => {
  it('uses production mode for the Expo Updates child process and keeps the original build env', async () => {
    jest.mocked(silentResolveFrom).mockReturnValue('/project/node_modules/expo-updates/bin/cli');
    const env = {
      NODE_ENV: 'staging',
      __EXPO_CONFIG_MODE: 'staging',
      FROM_BUILD: 'true',
    };

    await expoUpdatesCommandAsync('/project', ['runtimeversion:resolve'], {
      env,
      mode: 'production',
    });

    expect(spawnAsync).toHaveBeenCalledWith(
      '/project/node_modules/expo-updates/bin/cli',
      ['runtimeversion:resolve'],
      {
        stdio: 'pipe',
        cwd: '/project',
        env: {
          NODE_ENV: 'production',
          __EXPO_CONFIG_MODE: 'production',
          FROM_BUILD: 'true',
        },
      }
    );
    expect(env).toEqual({
      NODE_ENV: 'staging',
      __EXPO_CONFIG_MODE: 'staging',
      FROM_BUILD: 'true',
    });
  });
});
