import * as fs from 'fs-extra';
import { parse as parseDotenv } from 'dotenv';
import * as realFs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  EAS_SIMULATOR_EGRESS_ALLOW,
  EAS_SIMULATOR_EGRESS_FINGERPRINT,
  EAS_SIMULATOR_EGRESS_PORT,
  EAS_SIMULATOR_EGRESS_TOKEN,
  EAS_SIMULATOR_EGRESS_URL,
  EAS_SIMULATOR_SESSION_ID,
  SIMULATOR_DOTENV_FILE_HEADER,
  getSimulatorEnvFilePath,
  loadSimulatorEnvAsync,
  resetSimulatorEnvAsync,
  writeSimulatorEnvAsync,
} from '../env';
import { readLocalEgressConfigFromEnv } from '../egress';

jest.mock('fs-extra');

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

describe(loadSimulatorEnvAsync, () => {
  let projectDir: string;
  let previousEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    previousEnv = { ...process.env };
    projectDir = await realFs.mkdtemp(path.join(os.tmpdir(), 'eas-simulator-env-'));
    jest.mocked(fs.readFile).mockImplementation(jest.requireActual('fs-extra').readFile);
    process.env[EAS_SIMULATOR_EGRESS_ALLOW] = 'localhost:3000';
    process.env[EAS_SIMULATOR_SESSION_ID] = 'session-a';
    process.env[EAS_SIMULATOR_EGRESS_URL] = 'https://session-a.example.test';
    process.env[EAS_SIMULATOR_EGRESS_TOKEN] = 'session-a-token';
    process.env[EAS_SIMULATOR_EGRESS_FINGERPRINT] = 'session-a-fingerprint';
    process.env[EAS_SIMULATOR_EGRESS_PORT] = '8899';
    process.env.AGENT_DEVICE_DAEMON_BASE_URL = 'https://agent-a.example.test';
    process.env.AGENT_DEVICE_DAEMON_AUTH_TOKEN = 'agent-a-token';
    process.env.EAS_SIMULATOR_ENV_TEST_UNRELATED = 'keep-this';
  });

  afterEach(async () => {
    process.env = previousEnv;
    await realFs.rm(projectDir, { recursive: true, force: true });
    jest.resetAllMocks();
  });

  it.each(['', `${EAS_SIMULATOR_EGRESS_ALLOW}=''\n`])(
    "does not inherit another session's exceptions when the file has no exceptions (%j)",
    async allowLine => {
      await realFs.writeFile(
        getSimulatorEnvFilePath(projectDir),
        `${EAS_SIMULATOR_SESSION_ID}='session-b'\n` +
          `${EAS_SIMULATOR_EGRESS_URL}='https://session-b.example.test'\n` +
          allowLine
      );

      await loadSimulatorEnvAsync(projectDir);

      expect(process.env[EAS_SIMULATOR_SESSION_ID]).toBe('session-b');
      expect(process.env[EAS_SIMULATOR_EGRESS_ALLOW]).toBe('');
    }
  );

  it('preserves shell-exported exceptions when there is no simulator file', async () => {
    await loadSimulatorEnvAsync(projectDir);

    expect(process.env[EAS_SIMULATOR_EGRESS_ALLOW]).toBe('localhost:3000');
    expect(process.env[EAS_SIMULATOR_EGRESS_URL]).toBe('https://session-a.example.test');
    expect(process.env.AGENT_DEVICE_DAEMON_BASE_URL).toBe('https://agent-a.example.test');
    expect(process.env.AGENT_DEVICE_DAEMON_AUTH_TOKEN).toBe('agent-a-token');
    expect(process.env.EAS_SIMULATOR_ENV_TEST_UNRELATED).toBe('keep-this');
  });

  it('loads the file credentials and exceptions together over inherited values', async () => {
    await realFs.writeFile(
      getSimulatorEnvFilePath(projectDir),
      `${EAS_SIMULATOR_SESSION_ID}='session-b'\n` +
        "AGENT_DEVICE_DAEMON_BASE_URL='https://agent-b.example.test'\n" +
        "AGENT_DEVICE_DAEMON_AUTH_TOKEN='agent-b-token'\n" +
        `${EAS_SIMULATOR_EGRESS_URL}='https://session-b.example.test'\n` +
        `${EAS_SIMULATOR_EGRESS_TOKEN}='session-b-token'\n` +
        `${EAS_SIMULATOR_EGRESS_FINGERPRINT}='session-b-fingerprint'\n` +
        `${EAS_SIMULATOR_EGRESS_PORT}='8900'\n` +
        `${EAS_SIMULATOR_EGRESS_ALLOW}='localhost:4000'\n`
    );

    await loadSimulatorEnvAsync(projectDir);

    expect(readLocalEgressConfigFromEnv(process.env)).toEqual({
      url: 'https://session-b.example.test',
      token: 'session-b-token',
      fingerprint: 'session-b-fingerprint',
      port: 8900,
      allow: ['localhost:4000'],
    });
    expect(process.env[EAS_SIMULATOR_SESSION_ID]).toBe('session-b');
    expect(process.env.AGENT_DEVICE_DAEMON_BASE_URL).toBe('https://agent-b.example.test');
    expect(process.env.AGENT_DEVICE_DAEMON_AUTH_TOKEN).toBe('agent-b-token');
    expect(process.env.EAS_SIMULATOR_ENV_TEST_UNRELATED).toBe('keep-this');
  });

  it('replaces an inherited agent session with an Appium session without mixing controls', async () => {
    const capabilities = JSON.stringify({ platformName: 'iOS' });
    await realFs.writeFile(
      getSimulatorEnvFilePath(projectDir),
      `${EAS_SIMULATOR_SESSION_ID}='session-b'\n` +
        "APPIUM_URL='https://appium-b.example.test'\n" +
        `APPIUM_CAPS='${capabilities}'\n`
    );

    await loadSimulatorEnvAsync(projectDir);

    expect(process.env[EAS_SIMULATOR_SESSION_ID]).toBe('session-b');
    expect(process.env.APPIUM_URL).toBe('https://appium-b.example.test');
    expect(process.env.APPIUM_CAPS).toBe(capabilities);
    expect(process.env.AGENT_DEVICE_DAEMON_BASE_URL).toBeUndefined();
    expect(process.env.AGENT_DEVICE_DAEMON_AUTH_TOKEN).toBeUndefined();
    expect(process.env[EAS_SIMULATOR_EGRESS_URL]).toBeUndefined();
    expect(process.env[EAS_SIMULATOR_EGRESS_ALLOW]).toBe('');
    expect(process.env.EAS_SIMULATOR_ENV_TEST_UNRELATED).toBe('keep-this');
  });

  it.each(['', `${EAS_SIMULATOR_EGRESS_URL}='https://session-b.example.test'\n`])(
    'does not fill missing file credentials from a previous session (%j)',
    async egressLine => {
      await realFs.writeFile(
        getSimulatorEnvFilePath(projectDir),
        `${EAS_SIMULATOR_SESSION_ID}='session-b'\n${egressLine}`
      );

      await loadSimulatorEnvAsync(projectDir);

      expect(process.env[EAS_SIMULATOR_EGRESS_TOKEN]).toBeUndefined();
      expect(process.env[EAS_SIMULATOR_EGRESS_ALLOW]).toBe('');
      expect(() => readLocalEgressConfigFromEnv(process.env)).toThrow('no egress client to run');
    }
  );
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
