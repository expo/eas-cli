import { Config } from '@oclif/core';

import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { SimulatorAvailabilityQuery } from '../../../graphql/generated';
import { DeviceRunSessionAvailabilityQuery } from '../../../graphql/queries/DeviceRunSessionAvailabilityQuery';
import Log from '../../../log';
import { enableJsonOutput, printJsonOnlyOutput } from '../../../utils/json';
import SimulatorAvailability from '../availability';

jest.mock('../../../graphql/queries/DeviceRunSessionAvailabilityQuery');
jest.mock('../../../log');
jest.mock('../../../ora', () => ({
  ora: jest.fn(() => {
    const spinner = {
      fail: jest.fn(),
      start: jest.fn(),
      stop: jest.fn(),
      succeed: jest.fn(),
    };
    spinner.start.mockReturnValue(spinner);
    return spinner;
  }),
}));
jest.mock('../../../utils/json');

type OwnerAccount = SimulatorAvailabilityQuery['app']['byId']['ownerAccount'];

const mockByAppIdAsync = jest.mocked(DeviceRunSessionAvailabilityQuery.byAppIdAsync);
const mockEnableJsonOutput = jest.mocked(enableJsonOutput);
const mockPrintJsonOnlyOutput = jest.mocked(printJsonOnlyOutput);
const mockLog = jest.mocked(Log.log);

function makeOwnerAccount(deviceRunSessionsEnabled: boolean): OwnerAccount {
  return {
    id: 'account-123',
    name: 'testuser',
    deviceRunSessionsEnabled,
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

describe(SimulatorAvailability, () => {
  const graphqlClient = {} as ExpoGraphqlClient;
  const mockConfig = getMockOclifConfig();
  const projectId = 'project-123';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function createCommand(argv: string[]): SimulatorAvailability {
    const command = new SimulatorAvailability(argv, mockConfig);
    // @ts-expect-error getContextAsync is protected
    jest.spyOn(command, 'getContextAsync').mockResolvedValue({
      projectId,
      loggedIn: { graphqlClient },
    });
    return command;
  }

  it('emits JSON with available true when enabled', async () => {
    mockByAppIdAsync.mockResolvedValue(makeOwnerAccount(true));

    const command = createCommand(['--json']);
    await command.runAsync();

    expect(mockEnableJsonOutput).toHaveBeenCalled();
    expect(mockByAppIdAsync).toHaveBeenCalledWith(graphqlClient, projectId);
    expect(mockPrintJsonOnlyOutput).toHaveBeenCalledWith({
      available: true,
      accountName: 'testuser',
    });
  });

  it('emits JSON with available false when not enabled', async () => {
    mockByAppIdAsync.mockResolvedValue(makeOwnerAccount(false));

    const command = createCommand(['--json']);
    await command.runAsync();

    expect(mockPrintJsonOnlyOutput).toHaveBeenCalledWith({
      available: false,
      accountName: 'testuser',
    });
  });

  it('logs a graceful message when not enabled', async () => {
    mockByAppIdAsync.mockResolvedValue(makeOwnerAccount(false));

    const command = createCommand([]);
    await command.runAsync();

    expect(mockByAppIdAsync).toHaveBeenCalledWith(graphqlClient, projectId);
    expect(mockLog).toHaveBeenCalledWith(
      "EAS Simulator isn't available on testuser yet — it's coming soon."
    );
    expect(mockPrintJsonOnlyOutput).not.toHaveBeenCalled();
  });
});
