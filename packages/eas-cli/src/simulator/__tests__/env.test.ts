import { loadEnvFiles, loadProjectEnv } from '@expo/env';
import * as fs from 'fs-extra';
import { parse as parseDotenv } from 'dotenv';

import {
  EAS_SIMULATOR_SESSION_ID,
  SIMULATOR_DOTENV_FILE_HEADER,
  getSimulatorEnvFilePath,
  loadSimulatorEnvAsync,
  resetSimulatorEnvAsync,
  writeSimulatorEnvAsync,
} from '../env';

jest.mock('@expo/env', () => ({
  LOADED_ENV_NAME: '__EXPO_ENV_LOADED',
  loadEnvFiles: jest.fn(),
  loadProjectEnv: jest.fn(),
}));
jest.mock('fs-extra');

describe(loadSimulatorEnvAsync, () => {
  const projectDir = '/test/project';
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      DOTENV_VALUE: 'from-parent',
      KEEP_VALUE: 'from-shell',
      NODE_ENV: 'staging',
      __EXPO_ENV_LOADED: '["DOTENV_VALUE"]',
      __EXPO_CONFIG_MODE: 'production',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('loads simulator env in development mode without inherited dotenv values', async () => {
    jest.mocked(loadProjectEnv).mockImplementation(() => {
      expect(process.env.DOTENV_VALUE).toBeUndefined();
      expect(process.env.KEEP_VALUE).toBe('from-shell');
      expect(process.env.NODE_ENV).toBe('development');
      expect(process.env.__EXPO_ENV_LOADED).toBeUndefined();
      expect(process.env.__EXPO_CONFIG_MODE).toBeUndefined();
      return {} as never;
    });
    jest.mocked(loadEnvFiles).mockImplementation(() => {
      process.env.__EXPO_CONFIG_MODE = 'from-simulator-env';
      return {} as never;
    });

    await loadSimulatorEnvAsync(projectDir);

    expect(loadProjectEnv).toHaveBeenCalledWith(projectDir, {
      mode: 'development',
      silent: true,
    });
    expect(loadEnvFiles).toHaveBeenCalledWith([`${projectDir}/.env.eas-simulator`], {
      force: true,
    });
    expect(process.env.__EXPO_CONFIG_MODE).toBeUndefined();
  });
});

describe(resetSimulatorEnvAsync, () => {
  const projectDir = '/test/project';
  const simulatorDotenvPath = getSimulatorEnvFilePath(projectDir);

  beforeEach(() => {
    jest.clearAllMocks();
    jest
      .mocked(fs.readFile)
      .mockResolvedValue(`${EAS_SIMULATOR_SESSION_ID}='session-123'\n` as never);
    jest.mocked(fs.writeFile).mockResolvedValue(undefined as never);
    jest.mocked(fs.truncate).mockResolvedValue(undefined as never);
  });

  it('overwrites the simulator dotenv file with the header only', async () => {
    await resetSimulatorEnvAsync(projectDir, 'session-123');

    expect(fs.writeFile).toHaveBeenCalledWith(simulatorDotenvPath, SIMULATOR_DOTENV_FILE_HEADER, {
      flag: 'r+',
    });
    expect(fs.truncate).toHaveBeenCalledWith(
      simulatorDotenvPath,
      Buffer.byteLength(SIMULATOR_DOTENV_FILE_HEADER)
    );
  });

  it('ignores a missing simulator dotenv file', async () => {
    const err = Object.assign(new Error('missing file'), { code: 'ENOENT' });
    jest.mocked(fs.readFile).mockRejectedValue(err as never);

    await expect(resetSimulatorEnvAsync(projectDir, 'session-123')).resolves.toBeUndefined();

    expect(fs.writeFile).not.toHaveBeenCalled();
    expect(fs.truncate).not.toHaveBeenCalled();
  });

  it('does not overwrite a simulator dotenv file for a different session', async () => {
    await resetSimulatorEnvAsync(projectDir, 'different-session');

    expect(fs.writeFile).not.toHaveBeenCalled();
    expect(fs.truncate).not.toHaveBeenCalled();
  });

  it('rethrows non-missing-file errors', async () => {
    const err = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    jest.mocked(fs.readFile).mockRejectedValue(err as never);

    await expect(resetSimulatorEnvAsync(projectDir, 'session-123')).rejects.toThrow(
      'permission denied'
    );
  });
});

describe(writeSimulatorEnvAsync, () => {
  const projectDir = '/test/project';
  const simulatorDotenvPath = getSimulatorEnvFilePath(projectDir);

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(fs.writeFile).mockResolvedValue(undefined as never);
  });

  it('writes the simulator dotenv file with the header and environment variables', async () => {
    await writeSimulatorEnvAsync(projectDir, {
      AGENT_DEVICE_DAEMON_BASE_URL: 'https://agent.example.com',
      AGENT_DEVICE_DAEMON_AUTH_TOKEN: 'token-123',
      [EAS_SIMULATOR_SESSION_ID]: 'session-123',
    });

    expect(fs.writeFile).toHaveBeenCalledWith(
      simulatorDotenvPath,
      SIMULATOR_DOTENV_FILE_HEADER +
        "AGENT_DEVICE_DAEMON_BASE_URL='https://agent.example.com'\n" +
        "AGENT_DEVICE_DAEMON_AUTH_TOKEN='token-123'\n" +
        `${EAS_SIMULATOR_SESSION_ID}='session-123'\n`
    );
  });

  it('preserves serialized Appium capabilities as one dotenv value', async () => {
    const capabilities = JSON.stringify({
      platformName: 'iOS',
      note: `It's important to preserve "quotes" and \\slashes`,
    });

    await writeSimulatorEnvAsync(projectDir, { APPIUM_CAPS: capabilities });

    const writtenContent = jest.mocked(fs.writeFile).mock.calls[0][1];
    expect(parseDotenv(String(writtenContent)).APPIUM_CAPS).toBe(capabilities);
  });
});
