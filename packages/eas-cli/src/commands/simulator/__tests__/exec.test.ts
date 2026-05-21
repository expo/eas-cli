import { load } from '@expo/env';
import spawnAsync from '@expo/spawn-async';
import { Config } from '@oclif/core';

import SimulatorExec from '../exec';

jest.mock('@expo/env', () => ({
  load: jest.fn(),
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

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(spawnAsync).mockResolvedValue({} as never);
  });

  it('loads local env files and spawns the supplied command with inherited stdio', async () => {
    const command = new SimulatorExec(['agent-device', 'touch', '@e2'], mockConfig);

    await command.runAsync();

    expect(load).toHaveBeenCalledWith(process.cwd(), {
      force: true,
      silent: true,
    });
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
});
