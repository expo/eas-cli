import { loadEnvFiles, loadProjectEnv } from '@expo/env';
import spawnAsync from '@expo/spawn-async';
import { Config } from '@oclif/core';

import SimulatorExec from '../exec';

jest.mock('@expo/env', () => ({
  loadEnvFiles: jest.fn(),
  loadProjectEnv: jest.fn(),
}));
jest.mock('@expo/spawn-async');

function getMockOclifConfig(): Config {
  const config = new Config({ root: __dirname });
  config.runHook = async () => ({
    failures: [],
    successes: [],
  });
  return config;
}

describe(SimulatorExec, () => {
  const mockConfig = getMockOclifConfig();
  const projectDir = '/test/project';

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(spawnAsync).mockResolvedValue({} as never);
  });

  function createCommand(argv: string[]): {
    command: SimulatorExec;
    getContextAsync: jest.SpyInstance;
  } {
    const command = new SimulatorExec(argv, mockConfig);
    // @ts-expect-error getContextAsync is protected
    const getContextAsync = jest.spyOn(command, 'getContextAsync').mockResolvedValue({
      projectDir,
    });
    return { command, getContextAsync };
  }

  it('loads local env files and spawns the supplied command with inherited stdio', async () => {
    const { command, getContextAsync } = createCommand(['agent-device', 'touch', '@e2']);

    await command.runAsync();

    expect(getContextAsync).toHaveBeenCalledWith(SimulatorExec, {
      nonInteractive: true,
    });
    expect(loadProjectEnv).toHaveBeenCalledWith(projectDir, { silent: true });
    expect(loadEnvFiles).toHaveBeenCalledWith([`${projectDir}/.env.eas-simulator`], {
      force: true,
    });
    expect(spawnAsync).toHaveBeenCalledWith('agent-device', ['touch', '@e2'], {
      stdio: 'inherit',
      env: process.env,
    });
  });

  it('passes through command flags as args', async () => {
    const { command } = createCommand([
      'agent-device',
      'screenshot',
      '/test/path.png',
      '--format',
      'png',
    ]);

    await command.runAsync();

    expect(spawnAsync).toHaveBeenCalledWith(
      'agent-device',
      ['screenshot', '/test/path.png', '--format', 'png'],
      {
        stdio: 'inherit',
        env: process.env,
      }
    );
  });

  it('throws a helpful error when no command is provided', async () => {
    const { command, getContextAsync } = createCommand([]);

    await expect(command.runAsync()).rejects.toThrow(
      'No command provided. Run `eas simulator:exec <command> [args...]`.'
    );
    expect(getContextAsync).not.toHaveBeenCalled();
    expect(loadProjectEnv).not.toHaveBeenCalled();
    expect(loadEnvFiles).not.toHaveBeenCalled();
    expect(spawnAsync).not.toHaveBeenCalled();
  });

  it('loads simulator-specific env after regular env files', async () => {
    const { command } = createCommand(['agent-device', 'touch', '@e2']);
    await command.runAsync();

    expect(loadProjectEnv).toHaveBeenCalledWith(projectDir, { silent: true });
    expect(loadEnvFiles).toHaveBeenCalledWith([`${projectDir}/.env.eas-simulator`], {
      force: true,
    });
    expect(jest.mocked(loadProjectEnv).mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(loadEnvFiles).mock.invocationCallOrder[0]
    );
  });
});
