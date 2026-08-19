import { bunyan } from '@expo/logger';

import { readAppConfig } from '../appConfig';

jest.mock('@expo/env', () => ({
  parseProjectEnv: jest.fn(),
}));

jest.mock('@expo/config', () => ({
  getConfig: jest.fn(),
}));

jest.mock('../expoCli');

const { expoCommandAsync } = jest.requireMock('../expoCli') as {
  expoCommandAsync: jest.Mock;
};

const { getConfig } = jest.requireMock('@expo/config') as {
  getConfig: jest.Mock;
};

const { parseProjectEnv } = jest.requireMock('@expo/env') as {
  parseProjectEnv: jest.Mock;
};

const logger = { warn: jest.fn(), info: jest.fn(), error: jest.fn() } as unknown as bunyan;

const baseParams = {
  projectDir: '/project',
  env: { NODE_ENV: 'staging', __EXPO_CONFIG_MODE: 'staging' },
  logger,
};

describe(readAppConfig, () => {
  beforeEach(() => {
    jest.resetAllMocks();
    parseProjectEnv.mockReturnValue({ env: {}, files: [] });
    getConfig.mockReturnValue({
      exp: { name: 'fallback-app', slug: 'fallback-app' },
    });
  });

  it('returns config from expo CLI when it succeeds', async () => {
    const config = { exp: { name: 'test-app', slug: 'test-app' } };
    expoCommandAsync.mockResolvedValue({ stdout: JSON.stringify(config) });

    const result = await readAppConfig(baseParams);

    expect(result).toEqual(config);
    expect(expoCommandAsync).toHaveBeenCalledWith(
      '/project',
      ['config', '--json', '--full', '--type', 'public'],
      { env: { NODE_ENV: 'production' }, envMode: 'production' }
    );
    expect(getConfig).not.toHaveBeenCalled();
  });

  it('falls back to @expo/config when expo CLI fails', async () => {
    expoCommandAsync.mockRejectedValue(new Error('expo not found'));
    let fallbackEnv: NodeJS.ProcessEnv | undefined;
    getConfig.mockImplementation(() => {
      fallbackEnv = { ...process.env };
      return { exp: { name: 'fallback-app', slug: 'fallback-app' } };
    });

    const result = await readAppConfig(baseParams);

    expect(result).toEqual({ exp: { name: 'fallback-app', slug: 'fallback-app' } });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('expo not found'));
    expect(getConfig).toHaveBeenCalledWith('/project', {
      skipSDKVersionRequirement: true,
      isPublicConfig: true,
    });
    expect(fallbackEnv).toMatchObject({ NODE_ENV: 'production' });
    expect(fallbackEnv?.__EXPO_CONFIG_MODE).toBeUndefined();
  });

  it('throws when expo CLI returns invalid JSON and @expo/config also fails', async () => {
    expoCommandAsync.mockResolvedValue({ stdout: 'not json' });
    getConfig.mockImplementation(() => {
      throw new Error('@expo/config failed');
    });

    await expect(readAppConfig(baseParams)).rejects.toThrow('@expo/config failed');
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Failed to parse JSON output from 'expo config'")
    );
  });

  it('throws when expo CLI output is missing exp field and @expo/config also fails', async () => {
    expoCommandAsync.mockResolvedValue({ stdout: JSON.stringify({ other: 'data' }) });
    getConfig.mockImplementation(() => {
      throw new Error('@expo/config failed');
    });

    await expect(readAppConfig(baseParams)).rejects.toThrow('@expo/config failed');
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("missing 'exp' field"));
  });

  it('loads production .env files and keeps build values for SDK >= 49', async () => {
    const config = { exp: { name: 'test-app', slug: 'test-app' } };
    expoCommandAsync.mockResolvedValue({ stdout: JSON.stringify(config) });
    const originalProcessEnv = process.env;
    parseProjectEnv.mockImplementation(() => {
      return {
        env: {
          NODE_ENV: 'development',
          FROM_BUILD: 'from-dotenv',
          FROM_DOTENV: 'true',
          __EXPO_CONFIG_MODE: 'development',
        },
        files: [],
      };
    });

    await readAppConfig({
      ...baseParams,
      env: { ...baseParams.env, FROM_BUILD: 'true' },
      sdkVersion: '49.0.0',
    });

    expect(parseProjectEnv).toHaveBeenCalledWith('/project', {
      mode: 'production',
      systemEnv: {
        NODE_ENV: 'production',
        FROM_BUILD: 'true',
      },
    });
    expect(process.env).toBe(originalProcessEnv);
    expect(expoCommandAsync).toHaveBeenCalledWith('/project', expect.any(Array), {
      env: {
        NODE_ENV: 'production',
        FROM_BUILD: 'true',
        FROM_DOTENV: 'true',
      },
      envMode: 'production',
    });
  });

  it('uses EXPO_NO_DOTENV from the build env', async () => {
    const config = { exp: { name: 'test-app', slug: 'test-app' } };
    expoCommandAsync.mockResolvedValue({ stdout: JSON.stringify(config) });
    const originalProcessEnv = process.env;
    let noDotenvWhenParsed: string | undefined;
    parseProjectEnv.mockImplementation(() => {
      noDotenvWhenParsed = process.env.EXPO_NO_DOTENV;
      return { env: {}, files: [] };
    });

    await readAppConfig({
      ...baseParams,
      env: { ...baseParams.env, EXPO_NO_DOTENV: '1' },
      sdkVersion: '49.0.0',
    });

    expect(noDotenvWhenParsed).toBe('1');
    expect(process.env).toBe(originalProcessEnv);
  });

  it('does not load env vars from dotenv for SDK < 49', async () => {
    const config = { exp: { name: 'test-app', slug: 'test-app' } };
    expoCommandAsync.mockResolvedValue({ stdout: JSON.stringify(config) });

    await readAppConfig({ ...baseParams, sdkVersion: '48.0.0' });

    expect(parseProjectEnv).not.toHaveBeenCalled();
  });
});
