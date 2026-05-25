import * as fs from 'fs-extra';

import {
  EAS_SIMULATOR_SESSION_ID,
  SIMULATOR_DOTENV_FILE_HEADER,
  getSimulatorEnvFilePath,
  resetSimulatorEnvAsync,
  writeSimulatorEnvAsync,
} from '../env';

jest.mock('fs-extra');

describe(resetSimulatorEnvAsync, () => {
  const projectDir = '/test/project';
  const simulatorDotenvPath = getSimulatorEnvFilePath(projectDir);

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(fs.writeFile).mockResolvedValue(undefined as never);
    jest.mocked(fs.truncate).mockResolvedValue(undefined as never);
  });

  it('overwrites the simulator dotenv file with the header only', async () => {
    await resetSimulatorEnvAsync(projectDir);

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
    jest.mocked(fs.writeFile).mockRejectedValue(err as never);

    await expect(resetSimulatorEnvAsync(projectDir)).resolves.toBeUndefined();

    expect(fs.truncate).not.toHaveBeenCalled();
  });

  it('rethrows non-missing-file errors', async () => {
    const err = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    jest.mocked(fs.writeFile).mockRejectedValue(err as never);

    await expect(resetSimulatorEnvAsync(projectDir)).rejects.toThrow('permission denied');
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
        'AGENT_DEVICE_DAEMON_BASE_URL="https://agent.example.com"\n' +
        'AGENT_DEVICE_DAEMON_AUTH_TOKEN="token-123"\n' +
        `${EAS_SIMULATOR_SESSION_ID}="session-123"\n`
    );
  });
});
