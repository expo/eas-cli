import { loadEnvFiles, loadProjectEnv } from '@expo/env';
import spawnAsync from '@expo/spawn-async';
import { Config } from '@oclif/core';
import * as fs from 'fs-extra';

import SimulatorExec from '../exec';
import { EAS_SIMULATOR_SESSION_ID, SIMULATOR_DOTENV_FILE_HEADER } from '../../../simulator/env';

jest.mock('@expo/env', () => ({
  loadEnvFiles: jest.fn(),
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
  const projectDir = '/test/project';
  let previousEnv: NodeJS.ProcessEnv;
  let previousExitCode: typeof process.exitCode;
  const controllerVariables = [
    EAS_SIMULATOR_SESSION_ID,
    'AGENT_DEVICE_DAEMON_BASE_URL',
    'AGENT_DEVICE_DAEMON_AUTH_TOKEN',
    'ARGENT_TOOLS_URL',
    'ARGENT_AUTH_TOKEN',
    'APPIUM_URL',
    'APPIUM_CAPS',
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    previousEnv = { ...process.env };
    previousExitCode = process.exitCode;
    for (const key of controllerVariables) {
      delete process.env[key];
    }
    process.env.AGENT_DEVICE_DAEMON_BASE_URL = 'https://agent.example.test';
    process.env.AGENT_DEVICE_DAEMON_AUTH_TOKEN = 'agent-token';
    jest
      .mocked(fs.readFile)
      .mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }) as never);
    jest.mocked(spawnAsync).mockResolvedValue({} as never);
  });

  afterEach(() => {
    process.env = previousEnv;
    process.exitCode = previousExitCode;
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
    expect(loadEnvFiles).toHaveBeenCalledWith([`${projectDir}/.env.eas-simulator`], {
      force: true,
    });
    expect(jest.mocked(loadProjectEnv).mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(loadEnvFiles).mock.invocationCallOrder[0]
    );
  });

  it.each([
    ['missing file', undefined],
    ['empty file', ''],
    ['reset file', SIMULATOR_DOTENV_FILE_HEADER],
    ['session ID only', `${EAS_SIMULATOR_SESSION_ID}='session-123'\n`],
    [
      'agent endpoint only',
      `${EAS_SIMULATOR_SESSION_ID}='session-123'\nAGENT_DEVICE_DAEMON_BASE_URL='https://agent.example.test'\n`,
    ],
    [
      'agent token only',
      `${EAS_SIMULATOR_SESSION_ID}='session-123'\nAGENT_DEVICE_DAEMON_AUTH_TOKEN='agent-token'\n`,
    ],
    [
      'blank agent token',
      `${EAS_SIMULATOR_SESSION_ID}='session-123'\nAGENT_DEVICE_DAEMON_BASE_URL='https://agent.example.test'\nAGENT_DEVICE_DAEMON_AUTH_TOKEN='  '\n`,
    ],
    [
      'Appium endpoint only',
      `${EAS_SIMULATOR_SESSION_ID}='session-123'\nAPPIUM_URL='https://appium.example.test'\n`,
    ],
    ['Appium capabilities only', `${EAS_SIMULATOR_SESSION_ID}='session-123'\nAPPIUM_CAPS='{}'\n`],
    [
      'Argent token only',
      `${EAS_SIMULATOR_SESSION_ID}='session-123'\nARGENT_AUTH_TOKEN='argent-token'\n`,
    ],
  ])('does not run the child with %s and no exported connection', async (_name, content) => {
    for (const key of controllerVariables) {
      delete process.env[key];
    }
    if (content !== undefined) {
      jest.mocked(fs.readFile).mockResolvedValue(content as never);
    }
    const { command } = createCommand(['agent-device', 'snapshot']);

    await expect(command.runAsync()).rejects.toThrow(
      /No remote simulator connection is configured\.[\s\S]*Connection file: \/test\/project\/\.env.eas-simulator/
    );
    expect(spawnAsync).not.toHaveBeenCalled();
  });

  const controllerEnvironments = [
    {
      AGENT_DEVICE_DAEMON_BASE_URL: 'https://agent.example.test',
      AGENT_DEVICE_DAEMON_AUTH_TOKEN: 'agent-token',
    },
    { ARGENT_TOOLS_URL: 'https://argent.example.test' },
    { ARGENT_TOOLS_URL: 'https://argent.example.test', ARGENT_AUTH_TOKEN: 'argent-token' },
    { APPIUM_URL: 'https://appium.example.test', APPIUM_CAPS: '{"platformName":"iOS"}' },
  ];

  it.each(controllerEnvironments)(
    'runs with exported controller variables %j and no file',
    async env => {
      for (const key of controllerVariables) {
        delete process.env[key];
      }
      Object.assign(process.env, env);
      const { command } = createCommand(['client', '--help']);

      await command.runAsync();

      expect(spawnAsync).toHaveBeenCalledWith('client', ['--help'], {
        stdio: 'inherit',
        env: expect.objectContaining(env),
      });
    }
  );

  it.each(controllerEnvironments)('loads a saved controller connection %j', async env => {
    const file = Object.entries({ [EAS_SIMULATOR_SESSION_ID]: 'session-123', ...env })
      .map(([key, value]) => `${key}='${value}'`)
      .join('\n');
    jest.mocked(fs.readFile).mockResolvedValue(file as never);
    const { command } = createCommand(['client', '--help']);

    await command.runAsync();

    expect(spawnAsync).toHaveBeenCalledWith('client', ['--help'], {
      stdio: 'inherit',
      env: expect.objectContaining(env),
    });
    if (!('AGENT_DEVICE_DAEMON_BASE_URL' in env)) {
      expect(process.env.AGENT_DEVICE_DAEMON_BASE_URL).toBeUndefined();
      expect(process.env.AGENT_DEVICE_DAEMON_AUTH_TOKEN).toBeUndefined();
    }
  });

  it('rejects a session-only file instead of reusing an inherited controller connection', async () => {
    jest
      .mocked(fs.readFile)
      .mockResolvedValue(`${EAS_SIMULATOR_SESSION_ID}='session-123'\n` as never);
    const { command } = createCommand(['agent-device', 'snapshot']);

    await expect(command.runAsync()).rejects.toThrow(
      'No remote simulator connection is configured.'
    );
    expect(spawnAsync).not.toHaveBeenCalled();
  });

  it('rejects an endpoint-only file without filling its token from exported credentials', async () => {
    jest
      .mocked(fs.readFile)
      .mockResolvedValue("AGENT_DEVICE_DAEMON_BASE_URL='https://other.example.test'\n" as never);
    const { command } = createCommand(['agent-device', 'devices']);
    await expect(command.runAsync()).rejects.toThrow('Missing AGENT_DEVICE_DAEMON_AUTH_TOKEN');
    expect(spawnAsync).not.toHaveBeenCalled();
  });

  it.each([
    ['AGENT_DEVICE_DAEMON_BASE_URL', 'not-a-url'],
    ['AGENT_DEVICE_DAEMON_BASE_URL', 'file:///tmp/device'],
    ['AGENT_DEVICE_DAEMON_BASE_URL', 'ws://example.test'],
    ['ARGENT_TOOLS_URL', 'not-a-url'],
    ['APPIUM_URL', 'not-a-url'],
  ])('rejects an invalid %s without exposing its value', async (key, value) => {
    delete process.env.AGENT_DEVICE_DAEMON_BASE_URL;
    delete process.env.AGENT_DEVICE_DAEMON_AUTH_TOKEN;
    const url = `${value}?secret=must-not-print`;
    process.env[key] = url;
    if (key === 'AGENT_DEVICE_DAEMON_BASE_URL') {
      process.env.AGENT_DEVICE_DAEMON_AUTH_TOKEN = 'token';
    }
    if (key === 'APPIUM_URL') {
      process.env.APPIUM_CAPS = '{}';
    }
    const { command } = createCommand(['client']);
    const error = await command.runAsync().then(
      () => undefined,
      (error: Error) => error
    );
    expect(error?.message).toContain(`${key} must be an HTTP or HTTPS URL.`);
    expect(error?.message).not.toContain('must-not-print');
    expect(spawnAsync).not.toHaveBeenCalled();
  });

  it.each(['not-json', 'null', '[]', 'false', '1', '"text"'])(
    'rejects invalid Appium capabilities %s',
    async caps => {
      delete process.env.AGENT_DEVICE_DAEMON_BASE_URL;
      delete process.env.AGENT_DEVICE_DAEMON_AUTH_TOKEN;
      process.env.APPIUM_URL = 'http://localhost:4723';
      process.env.APPIUM_CAPS = caps;
      const { command } = createCommand(['client']);
      await expect(command.runAsync()).rejects.toThrow('APPIUM_CAPS must be a JSON object.');
      expect(spawnAsync).not.toHaveBeenCalled();
    }
  );

  it('does not ignore a partial controller when another controller is complete', async () => {
    process.env.ARGENT_AUTH_TOKEN = 'old-token';
    const { command } = createCommand(['client']);
    await expect(command.runAsync()).rejects.toThrow('Missing ARGENT_TOOLS_URL');
    expect(spawnAsync).not.toHaveBeenCalled();
  });

  async function runWithLifecycle(command: SimulatorExec): Promise<unknown> {
    jest.spyOn(command, 'run').mockImplementation(async () => command.runAsync());
    jest.spyOn(command, 'finally').mockResolvedValue(undefined);
    // @ts-expect-error _run drives the real error handler but is an oclif internal.
    return command._run();
  }

  it('reports a preflight error once without the generic failure footer', async () => {
    delete process.env.AGENT_DEVICE_DAEMON_BASE_URL;
    delete process.env.AGENT_DEVICE_DAEMON_AUTH_TOKEN;
    const { command } = createCommand(['client']);
    const error = await runWithLifecycle(command).then(
      () => undefined,
      (error: Error) => error
    );
    expect(error?.message).toContain('No remote simulator connection is configured.');
    expect(error?.message).not.toContain('command failed.');
  });

  it('reports a missing executable instead of failing silently', async () => {
    jest
      .mocked(spawnAsync)
      .mockRejectedValue(
        Object.assign(new Error('spawn missing-client ENOENT'), { code: 'ENOENT', status: null })
      );
    const { command } = createCommand(['missing-client']);
    await expect(runWithLifecycle(command)).rejects.toThrow('spawn missing-client ENOENT');
  });

  it('preserves the child exit code without reporting its arguments', async () => {
    jest
      .mocked(spawnAsync)
      .mockRejectedValue(
        Object.assign(new Error('client secret-token exited with non-zero code: 7'), { status: 7 })
      );
    process.exitCode = 0;
    const { command } = createCommand(['client', 'secret-token']);
    const reportError = jest.spyOn(command, 'error');
    await runWithLifecycle(command);
    expect(process.exitCode).toBe(7);
    expect(reportError).not.toHaveBeenCalled();
  });

  it('preserves signal termination without printing another child error', async () => {
    jest
      .mocked(spawnAsync)
      .mockRejectedValue(
        Object.assign(new Error('client terminated'), { status: null, signal: 'SIGTERM' })
      );
    const { command } = createCommand(['client']);
    const reportError = jest.spyOn(command, 'error');
    await runWithLifecycle(command);
    expect(process.exitCode).toBe(143);
    expect(reportError).not.toHaveBeenCalled();
  });
});
