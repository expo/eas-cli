import { bunyan } from '@expo/logger';

import { readAppConfig } from '../appConfig';

jest.mock('@expo/env', () => ({
  load: jest.fn(() => ({ FROM_DOTENV: 'true' })),
}));

jest.mock('@expo/config', () => ({
  getConfig: jest.fn(() => ({
    exp: { name: 'fallback-app', slug: 'fallback-app' },
  })),
}));

jest.mock('../expoCli');

const { expoCommandAsync } = jest.requireMock('../expoCli') as {
  expoCommandAsync: jest.Mock;
};

const { getConfig } = jest.requireMock('@expo/config') as {
  getConfig: jest.Mock;
};

const { load: loadEnv } = jest.requireMock('@expo/env') as {
  load: jest.Mock;
};

const logger = { warn: jest.fn(), info: jest.fn(), error: jest.fn() } as unknown as bunyan;

const baseParams = {
  projectDir: '/project',
  env: { NODE_ENV: 'production' },
  logger,
};

describe(readAppConfig, () => {
  it('returns config from expo CLI when it succeeds', async () => {
    const config = { exp: { name: 'test-app', slug: 'test-app' } };
    expoCommandAsync.mockResolvedValue({ stdout: JSON.stringify(config) });

    const result = await readAppConfig(baseParams);

    expect(result).toEqual(config);
    expect(expoCommandAsync).toHaveBeenCalledWith(
      '/project',
      ['config', '--json', '--full', '--type', 'public'],
      { env: baseParams.env }
    );
    expect(getConfig).not.toHaveBeenCalled();
  });

  it('falls back to @expo/config when expo CLI fails', async () => {
    expoCommandAsync.mockRejectedValue(new Error('expo not found'));

    const result = await readAppConfig(baseParams);

    expect(result).toEqual({ exp: { name: 'fallback-app', slug: 'fallback-app' } });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('expo not found'));
    expect(getConfig).toHaveBeenCalledWith('/project', {
      skipSDKVersionRequirement: true,
      isPublicConfig: true,
    });
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

  it('loads env vars from dotenv for SDK >= 49', async () => {
    const config = { exp: { name: 'test-app', slug: 'test-app' } };
    expoCommandAsync.mockResolvedValue({ stdout: JSON.stringify(config) });

    await readAppConfig({ ...baseParams, sdkVersion: '49.0.0' });

    expect(loadEnv).toHaveBeenCalledWith('/project');
    expect(expoCommandAsync).toHaveBeenCalledWith('/project', expect.any(Array), {
      env: { NODE_ENV: 'production', FROM_DOTENV: 'true' },
    });
  });

  it('does not load env vars from dotenv for SDK < 49', async () => {
    const config = { exp: { name: 'test-app', slug: 'test-app' } };
    expoCommandAsync.mockResolvedValue({ stdout: JSON.stringify(config) });

    await readAppConfig({ ...baseParams, sdkVersion: '48.0.0' });

    expect(loadEnv).not.toHaveBeenCalled();
  });
});
