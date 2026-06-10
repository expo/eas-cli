import { Config } from '@oclif/core';

import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import {
  DeviceRunSessionStatus,
  EnsureDeviceRunSessionStoppedMutation,
} from '../../../graphql/generated';
import { DeviceRunSessionMutation } from '../../../graphql/mutations/DeviceRunSessionMutation';
import {
  EAS_SIMULATOR_SESSION_ID,
  SIMULATOR_DOTENV_FILE_NAME,
  loadSimulatorEnvAsync,
} from '../../../simulator/env';
import { enableJsonOutput, printJsonOnlyOutput } from '../../../utils/json';
import SimulatorStop from '../stop';

jest.mock('../../../graphql/mutations/DeviceRunSessionMutation');
jest.mock('../../../simulator/env', () => ({
  ...jest.requireActual('../../../simulator/env'),
  loadSimulatorEnvAsync: jest.fn(),
}));
jest.mock('../../../ora', () => ({
  ora: jest.fn(() => {
    const spinner = {
      fail: jest.fn(),
      start: jest.fn(),
      succeed: jest.fn(),
    };
    spinner.start.mockReturnValue(spinner);
    return spinner;
  }),
}));
jest.mock('../../../utils/json');

type StoppedDeviceRunSession =
  EnsureDeviceRunSessionStoppedMutation['deviceRunSession']['ensureDeviceRunSessionStopped'];

const mockEnsureDeviceRunSessionStoppedAsync = jest.mocked(
  DeviceRunSessionMutation.ensureDeviceRunSessionStoppedAsync
);
const mockEnableJsonOutput = jest.mocked(enableJsonOutput);
const mockLoadSimulatorEnvironmentVariablesAsync = jest.mocked(loadSimulatorEnvAsync);
const mockPrintJsonOnlyOutput = jest.mocked(printJsonOnlyOutput);

function makeStoppedDeviceRunSession(
  overrides: Partial<StoppedDeviceRunSession> = {}
): StoppedDeviceRunSession {
  return {
    id: 'session-123',
    status: DeviceRunSessionStatus.Stopped,
    ...overrides,
  };
}

function getMockOclifConfig(): Config {
  const config = new Config({ root: __dirname });
  config.runHook = async () => ({
    failures: [],
    successes: [],
  });
  return config;
}

describe(SimulatorStop, () => {
  const graphqlClient = {} as ExpoGraphqlClient;
  const mockConfig = getMockOclifConfig();
  const projectDir = '/test/project';

  beforeEach(() => {
    jest.clearAllMocks();
    mockEnsureDeviceRunSessionStoppedAsync.mockResolvedValue(makeStoppedDeviceRunSession());
    mockLoadSimulatorEnvironmentVariablesAsync.mockResolvedValue();
  });

  function createCommand(argv: string[]): {
    command: SimulatorStop;
    getContextAsync: jest.SpyInstance;
  } {
    const command = new SimulatorStop(argv, mockConfig);
    // @ts-expect-error getContextAsync is protected
    const getContextAsync = jest.spyOn(command, 'getContextAsync').mockResolvedValue({
      loggedIn: { graphqlClient },
      projectDir,
    });
    return { command, getContextAsync };
  }

  it('emits JSON when --json is passed', async () => {
    const { command, getContextAsync } = createCommand(['--id', 'session-123', '--json']);
    await command.runAsync();

    expect(mockEnableJsonOutput).toHaveBeenCalled();
    expect(mockLoadSimulatorEnvironmentVariablesAsync).toHaveBeenCalledWith(projectDir);
    expect(getContextAsync).toHaveBeenCalledWith(SimulatorStop, {
      nonInteractive: true,
    });
    expect(mockEnsureDeviceRunSessionStoppedAsync).toHaveBeenCalledWith(
      graphqlClient,
      'session-123'
    );
    expect(mockPrintJsonOnlyOutput).toHaveBeenCalledWith({
      id: 'session-123',
      status: DeviceRunSessionStatus.Stopped,
    });
  });

  it(`uses ${EAS_SIMULATOR_SESSION_ID} from simulator env when --id is not passed`, async () => {
    const previousDeviceRunSessionId = process.env[EAS_SIMULATOR_SESSION_ID];
    process.env[EAS_SIMULATOR_SESSION_ID] = 'session-from-env';
    mockEnsureDeviceRunSessionStoppedAsync.mockResolvedValue(
      makeStoppedDeviceRunSession({ id: 'session-from-env' })
    );

    try {
      const { command } = createCommand([]);
      await command.runAsync();

      expect(mockLoadSimulatorEnvironmentVariablesAsync).toHaveBeenCalledWith(projectDir);
      expect(mockEnsureDeviceRunSessionStoppedAsync).toHaveBeenCalledWith(
        graphqlClient,
        'session-from-env'
      );
    } finally {
      if (previousDeviceRunSessionId === undefined) {
        delete process.env[EAS_SIMULATOR_SESSION_ID];
      } else {
        process.env[EAS_SIMULATOR_SESSION_ID] = previousDeviceRunSessionId;
      }
    }
  });

  it('throws a helpful error when no simulator session ID is available', async () => {
    const previousDeviceRunSessionId = process.env[EAS_SIMULATOR_SESSION_ID];
    delete process.env[EAS_SIMULATOR_SESSION_ID];

    try {
      const { command } = createCommand([]);

      await expect(command.runAsync()).rejects.toThrow(
        `No simulator session ID provided. Pass --id, or run \`eas simulator:start\` first to write ${SIMULATOR_DOTENV_FILE_NAME}.`
      );
      expect(mockLoadSimulatorEnvironmentVariablesAsync).toHaveBeenCalledWith(projectDir);
      expect(mockEnsureDeviceRunSessionStoppedAsync).not.toHaveBeenCalled();
    } finally {
      if (previousDeviceRunSessionId === undefined) {
        delete process.env[EAS_SIMULATOR_SESSION_ID];
      } else {
        process.env[EAS_SIMULATOR_SESSION_ID] = previousDeviceRunSessionId;
      }
    }
  });
});
