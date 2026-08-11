import spawnAsync from '@expo/spawn-async';
import { Config } from '@oclif/core';

import { EAS_SIMULATOR_SESSION_ID } from '../../../simulator/env';
import SimulatorFeedback from '../feedback';

jest.mock('@expo/spawn-async');

const mockSpawnAsync = jest.mocked(spawnAsync);

function getMockOclifConfig(): Config {
  const config = new Config({ root: __dirname });
  config.runHook = async () => ({
    failures: [],
    successes: [],
  });
  return config;
}

describe(SimulatorFeedback, () => {
  const mockConfig = getMockOclifConfig();
  const projectDir = '/test/project';
  const previousDeviceRunSessionId = process.env[EAS_SIMULATOR_SESSION_ID];

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env[EAS_SIMULATOR_SESSION_ID];
    mockSpawnAsync.mockResolvedValue({} as never);
  });

  afterAll(() => {
    if (previousDeviceRunSessionId === undefined) {
      delete process.env[EAS_SIMULATOR_SESSION_ID];
    } else {
      process.env[EAS_SIMULATOR_SESSION_ID] = previousDeviceRunSessionId;
    }
  });

  function createCommand(argv: string[]): {
    command: SimulatorFeedback;
    getContextAsync: jest.SpyInstance;
  } {
    const command = new SimulatorFeedback(argv, mockConfig);
    // @ts-expect-error getContextAsync is protected
    const getContextAsync = jest.spyOn(command, 'getContextAsync').mockResolvedValue({
      projectDir,
    });
    return { command, getContextAsync };
  }

  it('submits feedback through submit-expo-feedback with the simulator category', async () => {
    const { command } = createCommand([
      'Sessions boot fast, but exec feels slow',
      '--non-interactive',
    ]);
    await command.runAsync();

    expect(mockSpawnAsync).toHaveBeenCalledWith(
      'npx',
      [
        '--yes',
        'submit-expo-feedback@latest',
        '--category',
        'simulator',
        'Sessions boot fast, but exec feels slow',
      ],
      expect.objectContaining({
        cwd: projectDir,
        stdio: 'inherit',
      })
    );
  });

  it(`passes an inherited ${EAS_SIMULATOR_SESSION_ID} through to the subprocess`, async () => {
    process.env[EAS_SIMULATOR_SESSION_ID] = 'session-from-env';

    const { command } = createCommand(['Great product', '--non-interactive']);
    await command.runAsync();

    const spawnOptions = mockSpawnAsync.mock.calls[0][2]!;
    expect(spawnOptions.env?.[EAS_SIMULATOR_SESSION_ID]).toBe('session-from-env');
  });

  it('prefers --id over an inherited session variable', async () => {
    process.env[EAS_SIMULATOR_SESSION_ID] = 'session-from-env';

    const { command } = createCommand([
      'Great product',
      '--id',
      'session-from-flag',
      '--non-interactive',
    ]);
    await command.runAsync();

    const spawnOptions = mockSpawnAsync.mock.calls[0][2]!;
    expect(spawnOptions.env?.[EAS_SIMULATOR_SESSION_ID]).toBe('session-from-flag');
  });

  it('passes --subject through to submit-expo-feedback', async () => {
    const { command } = createCommand([
      'The exec command needs a quieter output mode',
      '--subject',
      'simulator:exec',
      '--non-interactive',
    ]);
    await command.runAsync();

    expect(mockSpawnAsync).toHaveBeenCalledWith(
      'npx',
      [
        '--yes',
        'submit-expo-feedback@latest',
        '--category',
        'simulator',
        '--subject',
        'simulator:exec',
        'The exec command needs a quieter output mode',
      ],
      expect.anything()
    );
  });

  it('does not leak an unset session variable into the subprocess env', async () => {
    const { command } = createCommand(['Great product', '--non-interactive']);
    await command.runAsync();

    const spawnOptions = mockSpawnAsync.mock.calls[0][2]!;
    expect(spawnOptions.env?.[EAS_SIMULATOR_SESSION_ID]).toBeUndefined();
  });

  it('throws a helpful error when no message is passed in non-interactive mode', async () => {
    const { command } = createCommand(['--non-interactive']);

    await expect(command.runAsync()).rejects.toThrow(
      'Feedback message is required in non-interactive mode. Run `eas simulator:feedback "<your feedback>"` to pass it as an argument.'
    );
    expect(mockSpawnAsync).not.toHaveBeenCalled();
  });

  it('spawns without a message in interactive mode so submit-expo-feedback prompts for it', async () => {
    const previousIsTTY = process.stdin.isTTY;
    const previousCI = process.env.CI;
    process.stdin.isTTY = true;
    delete process.env.CI;

    try {
      const { command } = createCommand([]);
      await command.runAsync();

      expect(mockSpawnAsync).toHaveBeenCalledWith(
        'npx',
        ['--yes', 'submit-expo-feedback@latest', '--category', 'simulator'],
        expect.anything()
      );
    } finally {
      process.stdin.isTTY = previousIsTTY;
      if (previousCI === undefined) {
        delete process.env.CI;
      } else {
        process.env.CI = previousCI;
      }
    }
  });
});
