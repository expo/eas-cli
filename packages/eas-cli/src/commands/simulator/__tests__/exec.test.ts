import { loadEnvFiles, loadProjectEnv } from '@expo/env';
import spawnAsync from '@expo/spawn-async';
import { Config } from '@oclif/core';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { SIMULATOR_DOTENV_FILE_HEADER } from '../../../simulator/env';
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

const READY_AGENT_DEVICE_SESSION =
  "AGENT_DEVICE_DAEMON_BASE_URL='https://agent.example.com'\n" +
  "AGENT_DEVICE_DAEMON_AUTH_TOKEN='token-123'\n" +
  "EAS_SIMULATOR_SESSION_ID='session-123'\n";

describe(SimulatorExec, () => {
  const mockConfig = getMockOclifConfig();
  let rootDir: string;
  let projectDir: string;
  let simulatorDotenvPath: string;
  let previousEnv: NodeJS.ProcessEnv;
  let spawnedEnv: NodeJS.ProcessEnv | undefined;

  beforeEach(async () => {
    jest.clearAllMocks();
    spawnedEnv = undefined;
    jest.mocked(spawnAsync).mockImplementation((async (
      _command: string,
      _args: string[],
      options: any
    ) => {
      spawnedEnv = { ...options.env };
      return {};
    }) as any);
    previousEnv = { ...process.env };
    for (const key of [
      'EAS_SIMULATOR_SESSION_ID',
      'EAS_SIMULATOR_SESSION_STATUS',
      'AGENT_DEVICE_DAEMON_BASE_URL',
      'AGENT_DEVICE_DAEMON_AUTH_TOKEN',
    ]) {
      delete process.env[key];
    }
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-simulator-exec-'));
    projectDir = path.join(rootDir, 'project');
    await fs.mkdir(projectDir);
    simulatorDotenvPath = path.join(projectDir, '.env.eas-simulator');
    await writeSimulatorEnvAsync(simulatorDotenvPath, READY_AGENT_DEVICE_SESSION);
  });

  afterEach(async () => {
    process.env = previousEnv;
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  async function writeSimulatorEnvAsync(filePath: string, content: string): Promise<void> {
    await fs.writeFile(filePath, SIMULATOR_DOTENV_FILE_HEADER + content);
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

  it('loads the project env and the session, and spawns the command with inherited stdio', async () => {
    const { command, getContextAsync } = createCommand(['agent-device', 'touch', '@e2']);

    await command.runAsync();

    expect(getContextAsync).toHaveBeenCalledWith(SimulatorExec, {
      nonInteractive: true,
    });
    expect(loadProjectEnv).toHaveBeenCalledWith(projectDir, { silent: true });
    expect(spawnAsync).toHaveBeenCalledWith('agent-device', ['touch', '@e2'], {
      stdio: 'inherit',
      env: process.env,
    });
    expect(spawnedEnv).toMatchObject({
      EAS_SIMULATOR_SESSION_ID: 'session-123',
      AGENT_DEVICE_DAEMON_BASE_URL: 'https://agent.example.com',
      AGENT_DEVICE_DAEMON_AUTH_TOKEN: 'token-123',
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
    expect(spawnAsync).not.toHaveBeenCalled();
  });

  it('applies the session after the project env files', async () => {
    jest.mocked(loadProjectEnv).mockImplementation(() => {
      process.env.AGENT_DEVICE_DAEMON_BASE_URL = 'https://from-project-env.example.com';
      return {} as any;
    });
    const { command } = createCommand(['agent-device', 'apps']);

    await command.runAsync();

    expect(spawnedEnv?.AGENT_DEVICE_DAEMON_BASE_URL).toBe('https://agent.example.com');
  });

  it('keeps already set values for variables that are not session variables', async () => {
    await writeSimulatorEnvAsync(
      simulatorDotenvPath,
      READY_AGENT_DEVICE_SESSION + "EAS_SIMULATOR_EXEC_TEST_VALUE='from-file'\n"
    );
    process.env.EAS_SIMULATOR_EXEC_TEST_VALUE = 'from-shell';
    const { command } = createCommand(['echo', 'hello']);

    await command.runAsync();

    expect(spawnedEnv?.EAS_SIMULATOR_EXEC_TEST_VALUE).toBe('from-shell');
  });

  it('spawns with the session it checked when the file changes after the check', async () => {
    // A concurrent `eas simulator:stop` resets the file while the command loads the project env.
    jest.mocked(loadProjectEnv).mockImplementation(() => {
      require('node:fs').writeFileSync(simulatorDotenvPath, SIMULATOR_DOTENV_FILE_HEADER);
      return {} as any;
    });
    const { command } = createCommand(['agent-device', 'apps']);

    await command.runAsync();

    expect(spawnedEnv).toMatchObject({
      EAS_SIMULATOR_SESSION_ID: 'session-123',
      AGENT_DEVICE_DAEMON_BASE_URL: 'https://agent.example.com',
    });
    expect(loadEnvFiles).not.toHaveBeenCalled();
  });

  it('fails instead of running the command when the simulator dotenv file is missing', async () => {
    await fs.rm(simulatorDotenvPath);
    // Values exported in the shell must not stand in for the missing session file.
    process.env.AGENT_DEVICE_DAEMON_BASE_URL = 'https://stale.example.com';
    const { command } = createCommand(['npx', 'agent-device', 'apps']);

    const error = await command.runAsync().catch(err => err);

    expect(error.message).toContain(`No simulator session found in ${simulatorDotenvPath}.`);
    expect(error.message).toContain('`--out-config-type env`');
    expect(error.message).not.toContain('has a simulator session');
    expect(spawnAsync).not.toHaveBeenCalled();
  });

  it('names a session file in a parent directory when the project has none', async () => {
    const childProjectDir = path.join(projectDir, 'app');
    await fs.mkdir(childProjectDir);
    const { command } = createCommand(['npx', 'agent-device', 'apps']);
    // @ts-expect-error getContextAsync is protected
    jest.spyOn(command, 'getContextAsync').mockResolvedValue({ projectDir: childProjectDir });

    const error = await command.runAsync().catch(err => err);

    expect(error.message).toContain(
      `No simulator session found in ${path.join(childProjectDir, '.env.eas-simulator')}.`
    );
    expect(error.message).toContain(
      `${simulatorDotenvPath} has a simulator session. To use it, run this command from ${projectDir}.`
    );
    expect(spawnAsync).not.toHaveBeenCalled();
  });

  it('fails instead of running the command when the session was stopped', async () => {
    // `eas simulator:stop` leaves only the header in the file.
    await writeSimulatorEnvAsync(simulatorDotenvPath, '');
    const { command } = createCommand(['echo', 'hello']);

    await expect(command.runAsync()).rejects.toThrow(
      `No simulator session found in ${simulatorDotenvPath}.`
    );
    expect(spawnAsync).not.toHaveBeenCalled();
  });

  it.each([
    [['npx', 'agent-device', 'apps']],
    [['pnpm', '--dir', './app', 'dlx', 'agent-device', 'apps']],
    [['yarn', 'run', 'e2e']],
    [['sh', '-c', 'agent-device apps']],
  ])('fails to run %j while the session is starting', async argv => {
    // `eas simulator:start` writes only the status and the session ID until the session is ready.
    await writeSimulatorEnvAsync(
      simulatorDotenvPath,
      "EAS_SIMULATOR_SESSION_STATUS='starting'\nEAS_SIMULATOR_SESSION_ID='session-123'\n"
    );
    const { command } = createCommand(argv);

    await expect(command.runAsync()).rejects.toThrow(
      `Simulator session session-123 in ${simulatorDotenvPath} is still starting.`
    );
    expect(spawnAsync).not.toHaveBeenCalled();
  });

  it('runs commands for a ready session of another type', async () => {
    process.env.AGENT_DEVICE_DAEMON_BASE_URL = 'https://stale.example.com';
    await writeSimulatorEnvAsync(
      simulatorDotenvPath,
      "ARGENT_TOOLS_URL='https://argent.example.com'\nEAS_SIMULATOR_SESSION_ID='session-123'\n"
    );
    const { command } = createCommand(['argent', 'tools']);

    await command.runAsync();

    expect(spawnAsync).toHaveBeenCalledWith('argent', ['tools'], {
      stdio: 'inherit',
      env: process.env,
    });
    expect(spawnedEnv?.ARGENT_TOOLS_URL).toBe('https://argent.example.com');
    expect(spawnedEnv?.AGENT_DEVICE_DAEMON_BASE_URL).toBeUndefined();
  });

  it('throws when the simulator dotenv file cannot be read', async () => {
    if (process.getuid?.() === 0) {
      // root can read the file regardless of its mode.
      return;
    }
    await fs.chmod(simulatorDotenvPath, 0o000);
    const { command } = createCommand(['echo', 'hello']);

    await expect(command.runAsync()).rejects.toMatchObject({ code: 'EACCES' });
    expect(spawnAsync).not.toHaveBeenCalled();
  });
});
