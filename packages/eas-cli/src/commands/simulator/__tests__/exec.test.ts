import { loadProjectEnv } from '@expo/env';
import spawnAsync from '@expo/spawn-async';
import { Config } from '@oclif/core';
import * as fs from 'fs-extra';

import SimulatorExec from '../exec';

jest.mock('@expo/env', () => ({
  loadProjectEnv: jest.fn(),
}));
jest.mock('@expo/spawn-async');
jest.mock('fs-extra');

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

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(spawnAsync).mockResolvedValue({} as never);
    jest.mocked(fs.pathExists).mockResolvedValue(false as never);
    jest.mocked(fs.readFile).mockResolvedValue('' as never);
  });

  it('loads local env files and spawns the supplied command with inherited stdio', async () => {
    const command = new SimulatorExec(['agent-device', 'touch', '@e2'], mockConfig);

    await command.runAsync();

    expect(loadProjectEnv).toHaveBeenCalledWith(process.cwd(), {
      force: true,
      silent: true,
    });
    expect(fs.pathExists).toHaveBeenCalledWith(`${process.cwd()}/.env.eas-simulator`);
    expect(spawnAsync).toHaveBeenCalledWith('agent-device', ['touch', '@e2'], {
      stdio: 'inherit',
      env: process.env,
    });
  });

  it('passes through command flags as args', async () => {
    const command = new SimulatorExec(
      ['agent-device', 'screenshot', '/test/path.png', '--format', 'png'],
      mockConfig
    );

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

  it('loads simulator-specific env after regular env files', async () => {
    const previousBaseUrl = process.env.AGENT_DEVICE_DAEMON_BASE_URL;
    jest.mocked(fs.pathExists).mockResolvedValue(true as never);
    jest
      .mocked(fs.readFile)
      .mockResolvedValue('AGENT_DEVICE_DAEMON_BASE_URL="https://agent.example.com"\n' as never);

    try {
      const command = new SimulatorExec(['agent-device', 'touch', '@e2'], mockConfig);
      await command.runAsync();

      expect(loadProjectEnv).toHaveBeenCalledWith(process.cwd(), {
        force: true,
        silent: true,
      });
      expect(process.env.AGENT_DEVICE_DAEMON_BASE_URL).toBe('https://agent.example.com');
    } finally {
      if (previousBaseUrl === undefined) {
        delete process.env.AGENT_DEVICE_DAEMON_BASE_URL;
      } else {
        process.env.AGENT_DEVICE_DAEMON_BASE_URL = previousBaseUrl;
      }
    }
  });
});
