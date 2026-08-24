import { getConfig, getConfigFilePaths, modifyConfigAsync } from '@expo/config';
import JsonFile from '@expo/json-file';
import { writeFileSync } from 'fs-extra';

import { createOrModifyExpoConfigAsync, getPrivateExpoConfigAsync } from '../expoConfig';
import { isExpoInstalled } from '../projectUtils';
import { spawnExpoCommand } from '../../utils/expoCli';

jest.mock('fs-extra');
jest.mock('@expo/config');
jest.mock('@expo/json-file');
jest.mock('../projectUtils');
jest.mock('../../utils/expoCli');

const originalEnv = process.env;

beforeEach(() => {
  jest.resetAllMocks();
  process.env = { ...originalEnv };
});

afterAll(() => {
  process.env = originalEnv;
});

describe('expoConfig', () => {
  it.each([
    ['the existing env', undefined],
    ['production mode', 'production'],
  ] as const)('uses %s when Expo CLI reads app config', async (_description, mode) => {
    const env = mode ? { APP_VARIANT: 'from-eas' } : undefined;
    process.env.DOTENV_VALUE = 'from-parent';
    process.env.NODE_ENV = 'staging';
    process.env.__EXPO_ENV_LOADED = '["DOTENV_VALUE"]';
    process.env.__EXPO_CONFIG_MODE = 'staging';
    jest.mocked(getConfigFilePaths).mockReturnValue({
      staticConfigPath: '/app/app.json',
      dynamicConfigPath: null,
    });
    jest.mocked(isExpoInstalled).mockReturnValue(true);
    jest.mocked(spawnExpoCommand).mockImplementation(() => {
      expect(process.env.APP_VARIANT).toBe(mode ? 'from-eas' : undefined);
      expect(process.env.DOTENV_VALUE).toBeUndefined();
      expect(process.env.NODE_ENV).toBe(mode ?? 'staging');
      expect(process.env.__EXPO_ENV_LOADED).toBeUndefined();
      expect(process.env.__EXPO_CONFIG_MODE).toBeUndefined();
      return Promise.resolve({
        stdout: JSON.stringify({ name: 'app', slug: 'app' }),
      }) as any;
    });

    await getPrivateExpoConfigAsync('/app', { env, mode });

    expect(spawnExpoCommand).toHaveBeenCalledWith('/app', ['config', '--json'], {
      env: {
        EXPO_NO_DOTENV: '1',
        ...(mode ? { NODE_ENV: mode, __EXPO_CONFIG_MODE: mode } : {}),
      },
    });
    expect(process.env.APP_VARIANT).toBeUndefined();
    expect(process.env.DOTENV_VALUE).toBe('from-parent');
    expect(process.env.NODE_ENV).toBe('staging');
    expect(process.env.__EXPO_ENV_LOADED).toBe('["DOTENV_VALUE"]');
    expect(process.env.__EXPO_CONFIG_MODE).toBe('staging');
  });

  it('uses the selected env and production mode with the bundled config fallback', async () => {
    process.env.DOTENV_VALUE = 'from-parent';
    process.env.NODE_ENV = 'staging';
    process.env.__EXPO_ENV_LOADED = '["DOTENV_VALUE"]';
    process.env.__EXPO_CONFIG_MODE = 'staging';
    const env = {
      DOTENV_VALUE: 'from-eas',
      __EXPO_ENV_LOADED: '["DOTENV_VALUE"]',
    };
    jest.mocked(getConfigFilePaths).mockReturnValue({
      staticConfigPath: '/app/app.json',
      dynamicConfigPath: null,
    });
    jest.mocked(isExpoInstalled).mockReturnValue(false);
    jest.mocked(getConfig).mockImplementation(() => {
      expect(process.env.DOTENV_VALUE).toBe('from-eas');
      expect(process.env.NODE_ENV).toBe('production');
      expect(process.env.__EXPO_ENV_LOADED).toBeUndefined();
      expect(process.env.__EXPO_CONFIG_MODE).toBeUndefined();
      return { exp: { name: 'app', slug: 'app' } } as any;
    });

    await getPrivateExpoConfigAsync('/app', { env, mode: 'production' });

    expect(env).toEqual({
      DOTENV_VALUE: 'from-eas',
      __EXPO_ENV_LOADED: '["DOTENV_VALUE"]',
    });
    expect(process.env.DOTENV_VALUE).toBe('from-parent');
    expect(process.env.NODE_ENV).toBe('staging');
    expect(process.env.__EXPO_ENV_LOADED).toBe('["DOTENV_VALUE"]');
    expect(process.env.__EXPO_CONFIG_MODE).toBe('staging');
  });

  it('uses the selected env and production mode when it modifies app config', async () => {
    process.env.NODE_ENV = 'staging';
    process.env.__EXPO_CONFIG_MODE = 'staging';
    jest.mocked(getConfigFilePaths).mockReturnValue({
      staticConfigPath: '/app/app.json',
      dynamicConfigPath: null,
    });
    jest.mocked(modifyConfigAsync).mockImplementation(async () => {
      expect(process.env.APP_VARIANT).toBe('preview');
      expect(process.env.NODE_ENV).toBe('production');
      expect(process.env.__EXPO_CONFIG_MODE).toBeUndefined();
      return { type: 'success', config: {} as any };
    });

    await createOrModifyExpoConfigAsync(
      '/app',
      {},
      { env: { APP_VARIANT: 'preview' }, mode: 'production' }
    );

    expect(modifyConfigAsync).toHaveBeenCalledWith('/app', {}, {});
    expect(process.env.APP_VARIANT).toBeUndefined();
    expect(process.env.NODE_ENV).toBe('staging');
    expect(process.env.__EXPO_CONFIG_MODE).toBe('staging');
  });

  describe('createOrModifyExpoConfigAsync', () => {
    it('should create a new app config file if it does not exist', async () => {
      jest.mocked(getConfigFilePaths).mockReturnValue({
        staticConfigPath: null,
        dynamicConfigPath: null,
      });

      await createOrModifyExpoConfigAsync('/app', {});
      expect(writeFileSync).toHaveBeenCalledWith('/app/app.json', '{\n  "expo": {}\n}');
    });

    it('should delegate to modifyConfigAsync if ', async () => {
      jest.mocked(getConfigFilePaths).mockReturnValue({
        staticConfigPath: '/app/app.json',
        dynamicConfigPath: null,
      });
      jest.mocked(JsonFile.readAsync).mockResolvedValue({ expo: {} });

      await createOrModifyExpoConfigAsync('/app', {});
      // modifyConfigAsync is mocked so this shouldn't be called
      expect(writeFileSync).not.toHaveBeenCalled();
    });

    it('should modify an existing config file if it exists', async () => {
      jest.mocked(getConfigFilePaths).mockReturnValue({
        staticConfigPath: '/app/app.json',
        dynamicConfigPath: null,
      });
      jest.mocked(JsonFile.readAsync).mockResolvedValue({ expo: {} });

      await createOrModifyExpoConfigAsync('/app', { owner: 'ccheever' });
      expect(modifyConfigAsync).toHaveBeenCalledWith('/app', { owner: 'ccheever' });
    });
  });
});
