import spawnAsync from '@expo/spawn-async';
import { silent as silentResolveFrom } from 'resolve-from';

import { expoUpdatesCommandAsync } from '../expoUpdatesCli';

jest.mock('@expo/spawn-async', () => ({
  __esModule: true,
  default: jest.fn().mockResolvedValue({ stdout: '' }),
}));

jest.mock('resolve-from', () => ({
  __esModule: true,
  default: jest.fn(),
  silent: jest.fn(),
}));

describe(expoUpdatesCommandAsync, () => {
  it('passes production mode to the Expo Updates child process and keeps the input env unchanged', async () => {
    jest.mocked(silentResolveFrom).mockReturnValue('/project/node_modules/expo-updates/bin/cli');
    const originalProcessEnv = process.env;
    const env = {
      NODE_ENV: 'staging',
      __EXPO_CONFIG_MODE: 'staging',
      DOTENV_VALUE: 'from-command',
      FROM_COMMAND: 'true',
      __EXPO_ENV_LOADED: '["DOTENV_VALUE"]',
    };
    const processEnv = {
      NODE_ENV: 'development',
      __EXPO_CONFIG_MODE: 'development',
      FROM_PROCESS: 'true',
      PARENT_DOTENV_VALUE: 'from-parent',
      __EXPO_ENV_LOADED: '["PARENT_DOTENV_VALUE"]',
    };
    process.env = processEnv;

    try {
      await expoUpdatesCommandAsync('/project', ['runtimeversion:resolve'], {
        env,
        cwd: '/working-directory',
        mode: 'production',
      });
      expect(process.env).toBe(processEnv);
      expect(process.env.PARENT_DOTENV_VALUE).toBe('from-parent');
      expect(process.env.__EXPO_ENV_LOADED).toBe('["PARENT_DOTENV_VALUE"]');
    } finally {
      process.env = originalProcessEnv;
    }

    expect(spawnAsync).toHaveBeenCalledWith(
      '/project/node_modules/expo-updates/bin/cli',
      ['runtimeversion:resolve'],
      {
        stdio: 'pipe',
        env: {
          NODE_ENV: 'production',
          __EXPO_CONFIG_MODE: 'production',
          FROM_PROCESS: 'true',
          DOTENV_VALUE: 'from-command',
          FROM_COMMAND: 'true',
        },
        cwd: '/working-directory',
      }
    );
    expect(env).toEqual({
      NODE_ENV: 'staging',
      __EXPO_CONFIG_MODE: 'staging',
      DOTENV_VALUE: 'from-command',
      FROM_COMMAND: 'true',
      __EXPO_ENV_LOADED: '["DOTENV_VALUE"]',
    });
  });
});
