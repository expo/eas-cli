import { bunyan } from '@expo/logger';
import spawnAsync from '@expo/turtle-spawn';

import { Datadog } from '../../datadog';
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
jest.mock('@expo/turtle-spawn');

jest.mock('../../datadog', () => ({
  Datadog: {
    log: jest.fn(),
  },
}));

const { expoCommandAsync } = jest.requireMock('../expoCli') as {
  expoCommandAsync: jest.Mock;
};

const { getConfig } = jest.requireMock('@expo/config') as {
  getConfig: jest.Mock;
};

const { load: loadEnv } = jest.requireMock('@expo/env') as {
  load: jest.Mock;
};

const datadogLogMock = jest.mocked(Datadog.log);
const spawnAsyncMock = jest.mocked(spawnAsync);

const logger = { warn: jest.fn(), info: jest.fn(), error: jest.fn() } as unknown as bunyan;

const baseParams = {
  projectDir: '/project',
  env: { NODE_ENV: 'production' },
  logger,
};

function getCloudEnv(buildId: string) {
  return {
    NODE_ENV: 'development',
    EAS_BUILD_RUNNER: 'eas-build',
    EAS_BUILD_ID: buildId,
  };
}

function getEnvWorkerResult(env: Record<string, string> = {}) {
  return {
    stdout: JSON.stringify(env),
  } as never;
}

describe(readAppConfig, () => {
  beforeEach(() => {
    jest.resetAllMocks();
    loadEnv.mockReturnValue({ FROM_DOTENV: 'true' });
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

  it("doesn't compare app config for local builds", async () => {
    const config = { exp: { name: 'test-app', slug: 'test-app' } };
    expoCommandAsync.mockResolvedValue({ stdout: JSON.stringify(config) });

    await readAppConfig({
      ...baseParams,
      env: {
        NODE_ENV: 'development',
        EAS_BUILD_RUNNER: 'local-build-plugin',
        EAS_BUILD_ID: 'local-build',
      },
    });

    expect(expoCommandAsync).toHaveBeenCalledTimes(1);
    expect(spawnAsyncMock).not.toHaveBeenCalled();
    expect(datadogLogMock).not.toHaveBeenCalled();
  });

  it('logs a match when app config is the same in production mode', async () => {
    const config = { exp: { name: 'test-app', slug: 'test-app' } };
    const env = getCloudEnv('matching-build');
    expoCommandAsync.mockResolvedValue({ stdout: JSON.stringify(config) });

    const result = await readAppConfig({ ...baseParams, env });

    expect(result).toEqual(config);
    expect(expoCommandAsync).toHaveBeenNthCalledWith(
      2,
      '/project',
      ['config', '--json', '--full', '--type', 'public'],
      {
        env: {
          NODE_ENV: 'production',
          EAS_BUILD_RUNNER: 'eas-build',
          EAS_BUILD_ID: 'matching-build',
          __EXPO_CONFIG_MODE: 'production',
        },
      }
    );
    expect(datadogLogMock).toHaveBeenCalledWith('App config production mode comparison match', {
      event: 'app_config_production_mode_comparison',
      status: 'match',
      current_source: 'expo-cli',
      production_source: 'expo-cli',
    });
  });

  it('keeps the current app config and logs a production mode mismatch', async () => {
    const currentConfig = { exp: { name: 'current-app', slug: 'test-app' } };
    const productionConfig = { exp: { name: 'production-app', slug: 'test-app' } };
    const env = {
      ...getCloudEnv('mismatching-build'),
      FROM_BUILD: 'true',
    };
    loadEnv.mockReturnValue({ FROM_CURRENT_DOTENV: 'true' });
    spawnAsyncMock.mockResolvedValue(
      getEnvWorkerResult({
        FROM_BUILD: 'from-dotenv',
        FROM_PRODUCTION_DOTENV: 'true',
      })
    );
    expoCommandAsync
      .mockResolvedValueOnce({ stdout: JSON.stringify(currentConfig) })
      .mockResolvedValueOnce({ stdout: JSON.stringify(productionConfig) });

    const result = await readAppConfig({
      ...baseParams,
      env,
      sdkVersion: '49.0.0',
    });

    expect(result).toEqual(currentConfig);
    expect(env).toEqual({
      NODE_ENV: 'development',
      EAS_BUILD_RUNNER: 'eas-build',
      EAS_BUILD_ID: 'mismatching-build',
      FROM_BUILD: 'true',
    });
    expect(spawnAsyncMock).toHaveBeenCalledWith(
      process.execPath,
      [expect.stringMatching(/appConfigEnvWorker\.js$/), '/project'],
      {
        cwd: '/project',
        env: {
          NODE_ENV: 'production',
          EAS_BUILD_RUNNER: 'eas-build',
          EAS_BUILD_ID: 'mismatching-build',
          FROM_BUILD: 'true',
          __EXPO_CONFIG_MODE: 'production',
        },
        stdio: 'pipe',
      }
    );
    expect(expoCommandAsync).toHaveBeenNthCalledWith(
      2,
      '/project',
      ['config', '--json', '--full', '--type', 'public'],
      {
        env: {
          NODE_ENV: 'production',
          EAS_BUILD_RUNNER: 'eas-build',
          EAS_BUILD_ID: 'mismatching-build',
          FROM_BUILD: 'true',
          FROM_PRODUCTION_DOTENV: 'true',
          __EXPO_CONFIG_MODE: 'production',
        },
      }
    );
    expect(datadogLogMock).toHaveBeenCalledWith('App config production mode comparison mismatch', {
      event: 'app_config_production_mode_comparison',
      status: 'mismatch',
      current_source: 'expo-cli',
      production_source: 'expo-cli',
    });
    expect(JSON.stringify(datadogLogMock.mock.calls)).not.toContain('current-app');
    expect(JSON.stringify(datadogLogMock.mock.calls)).not.toContain('production-app');
  });

  it("doesn't compare app config when the current read uses bundled @expo/config", async () => {
    const config = { exp: { name: 'test-app', slug: 'test-app' } };
    expoCommandAsync.mockRejectedValue(new Error('expo not found'));
    getConfig.mockReturnValue(config);

    const result = await readAppConfig({
      ...baseParams,
      env: getCloudEnv('bundled-config-build'),
    });

    expect(result).toEqual(config);
    expect(spawnAsyncMock).not.toHaveBeenCalled();
    expect(datadogLogMock).toHaveBeenCalledWith('App config production mode comparison error', {
      event: 'app_config_production_mode_comparison',
      status: 'error',
      current_source: 'bundled-config',
      reason: 'current_read_used_fallback',
    });
  });

  it('keeps the current app config when the production read fails', async () => {
    const currentConfig = { exp: { name: 'current-app', slug: 'test-app' } };
    expoCommandAsync
      .mockResolvedValueOnce({ stdout: JSON.stringify(currentConfig) })
      .mockRejectedValueOnce(new Error('production config failed'));

    const result = await readAppConfig({
      ...baseParams,
      env: getCloudEnv('failed-production-build'),
    });

    expect(result).toEqual(currentConfig);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(datadogLogMock).toHaveBeenCalledWith('App config production mode comparison error', {
      event: 'app_config_production_mode_comparison',
      status: 'error',
      current_source: 'expo-cli',
      reason: 'production_read_failed',
    });
  });

  it("doesn't compare app config more than once for the same build", async () => {
    const config = { exp: { name: 'test-app', slug: 'test-app' } };
    const params = {
      ...baseParams,
      env: getCloudEnv('repeated-build'),
    };
    expoCommandAsync.mockResolvedValue({ stdout: JSON.stringify(config) });

    await readAppConfig(params);
    await readAppConfig(params);

    expect(expoCommandAsync).toHaveBeenCalledTimes(3);
    expect(datadogLogMock).toHaveBeenCalledTimes(1);
  });

  it("doesn't fail the build when Datadog logging fails", async () => {
    const config = { exp: { name: 'test-app', slug: 'test-app' } };
    expoCommandAsync.mockResolvedValue({ stdout: JSON.stringify(config) });
    datadogLogMock.mockImplementation(() => {
      throw new Error('Datadog failed');
    });

    await expect(
      readAppConfig({
        ...baseParams,
        env: getCloudEnv('datadog-failure-build'),
      })
    ).resolves.toEqual(config);
  });
});
