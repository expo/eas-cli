import { loadEnvFiles, loadProjectEnv } from '@expo/env';
import spawnAsync from '@expo/spawn-async';
import { Config } from '@oclif/core';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { SIMULATOR_DOTENV_FILE_HEADER } from '../../../simulator/env';
import SimulatorExec, { isAgentDeviceCommand } from '../exec';

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
  let projectDir: string;
  let simulatorDotenvPath: string;
  let previousEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.mocked(spawnAsync).mockResolvedValue({} as never);
    previousEnv = { ...process.env };
    delete process.env.EAS_SIMULATOR_SESSION_ID;
    delete process.env.AGENT_DEVICE_DAEMON_BASE_URL;
    delete process.env.AGENT_DEVICE_DAEMON_AUTH_TOKEN;
    projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-simulator-exec-'));
    simulatorDotenvPath = path.join(projectDir, '.env.eas-simulator');
    await writeSimulatorEnvAsync(
      "EAS_SIMULATOR_SESSION_ID='session-123'\n" +
        "AGENT_DEVICE_DAEMON_BASE_URL='https://agent.example.com'\n" +
        "AGENT_DEVICE_DAEMON_AUTH_TOKEN='token-123'\n"
    );
  });

  afterEach(async () => {
    process.env = previousEnv;
    await fs.rm(projectDir, { recursive: true, force: true });
  });

  async function writeSimulatorEnvAsync(content: string): Promise<void> {
    await fs.writeFile(simulatorDotenvPath, SIMULATOR_DOTENV_FILE_HEADER + content);
  }

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
    expect(loadEnvFiles).toHaveBeenCalledWith([simulatorDotenvPath], {
      force: true,
    });
    expect(spawnAsync).toHaveBeenCalledWith('agent-device', ['touch', '@e2'], {
      stdio: 'inherit',
      env: process.env,
    });
    expect(process.env.AGENT_DEVICE_DAEMON_BASE_URL).toBe('https://agent.example.com');
    expect(process.env.AGENT_DEVICE_DAEMON_AUTH_TOKEN).toBe('token-123');
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

  it('does not emit an oclif unparsed arguments warning', async () => {
    const { command } = createCommand(['echo', '"test"']);
    const emitWarningSpy = jest.spyOn(process, 'emitWarning').mockImplementation();
    jest.spyOn(command, 'run').mockImplementation(async () => {
      await command.runAsync();
    });
    jest.spyOn(command, 'finally').mockResolvedValue(undefined);

    try {
      // @ts-expect-error _run is internal to oclif, but it is where the unparsed warning is emitted.
      await command._run();

      const emittedUnparsedCommandWarning = emitWarningSpy.mock.calls.some(([warning, options]) => {
        return (
          typeof warning === 'string' &&
          warning.includes('did not parse its arguments') &&
          typeof options === 'object' &&
          options !== null &&
          'code' in options &&
          options.code === 'UnparsedCommand'
        );
      });
      expect(emittedUnparsedCommandWarning).toBe(false);
    } finally {
      emitWarningSpy.mockRestore();
    }
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
    expect(loadEnvFiles).toHaveBeenCalledWith([simulatorDotenvPath], {
      force: true,
    });
    expect(jest.mocked(loadProjectEnv).mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(loadEnvFiles).mock.invocationCallOrder[0]
    );
  });

  it('fails instead of running the command when the simulator dotenv file is missing', async () => {
    await fs.rm(simulatorDotenvPath);
    // Values exported in the shell must not stand in for the missing session file.
    process.env.AGENT_DEVICE_DAEMON_BASE_URL = 'https://stale.example.com';
    const { command } = createCommand(['npx', 'agent-device', 'apps']);

    await expect(command.runAsync()).rejects.toThrow(
      `No simulator session found in ${simulatorDotenvPath}.`
    );
    expect(spawnAsync).not.toHaveBeenCalled();
  });

  it('fails instead of running the command when the session was stopped', async () => {
    // `eas simulator:stop` leaves only the header in the file.
    await writeSimulatorEnvAsync('');
    const { command } = createCommand(['echo', 'hello']);

    await expect(command.runAsync()).rejects.toThrow(
      `No simulator session found in ${simulatorDotenvPath}.`
    );
    expect(spawnAsync).not.toHaveBeenCalled();
  });

  it.each([
    [['agent-device', 'apps']],
    [['npx', 'agent-device', 'apps']],
    [['bunx', 'agent-device@latest', 'apps']],
    [['npx', '-y', 'agent-device', 'apps']],
    [['pnpm', 'dlx', 'agent-device', 'apps']],
  ])(
    'fails to run agent-device (%j) when the session has no agent-device connection',
    async argv => {
      // `eas simulator:start` writes only the session ID until the session is ready.
      await writeSimulatorEnvAsync("EAS_SIMULATOR_SESSION_ID='session-123'\n");
      const { command } = createCommand(argv);

      await expect(command.runAsync()).rejects.toThrow(
        `Simulator session session-123 in ${simulatorDotenvPath} has no agent-device connection.`
      );
      expect(spawnAsync).not.toHaveBeenCalled();
    }
  );

  it('runs other commands when the session has no agent-device connection', async () => {
    await writeSimulatorEnvAsync(
      "EAS_SIMULATOR_SESSION_ID='session-123'\nARGENT_TOOLS_URL='https://argent.example.com'\n"
    );
    const { command } = createCommand(['argent', 'tools']);

    await command.runAsync();

    expect(spawnAsync).toHaveBeenCalledWith('argent', ['tools'], {
      stdio: 'inherit',
      env: process.env,
    });
  });
});

describe(isAgentDeviceCommand, () => {
  it.each([
    ['agent-device', []],
    ['/project/node_modules/.bin/agent-device', ['apps']],
    ['npx', ['agent-device', 'apps']],
    ['npx', ['--yes', 'agent-device@0.21.37', 'apps']],
    ['bunx', ['agent-device@latest', 'apps']],
    ['pnpm', ['exec', 'agent-device', 'apps']],
    ['yarn', ['dlx', 'agent-device', 'apps']],
  ])('detects %s %j', (command, args) => {
    expect(isAgentDeviceCommand(command, args)).toBe(true);
  });

  it.each([
    ['echo', ['agent-device']],
    ['argent', ['tools']],
    ['npx', ['expo', 'start']],
    ['node', ['agent-device.js']],
  ])('ignores %s %j', (command, args) => {
    expect(isAgentDeviceCommand(command, args)).toBe(false);
  });
});
