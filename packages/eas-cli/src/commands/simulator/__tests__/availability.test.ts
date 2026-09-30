import { Config } from '@oclif/core';

import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { DeviceRunSessionAvailabilityQuery } from '../../../graphql/queries/DeviceRunSessionAvailabilityQuery';
import Log from '../../../log';
import { EAS_SIMULATOR_WAITLIST_URL } from '../../../simulator/utils';
import { enableJsonOutput, printJsonOnlyOutput } from '../../../utils/json';
import SimulatorAvailability from '../availability';

jest.mock('../../../graphql/queries/DeviceRunSessionAvailabilityQuery');
jest.mock('../../../log', () => ({
  __esModule: true,
  default: {
    log: jest.fn(),
  },
  link: jest.fn((url: string) => url),
}));
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

const mockByAppIdAsync = jest.mocked(DeviceRunSessionAvailabilityQuery.byAppIdAsync);
const mockEnableJsonOutput = jest.mocked(enableJsonOutput);
const mockPrintJsonOnlyOutput = jest.mocked(printJsonOnlyOutput);
const mockLog = jest.mocked(Log.log);

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

  function createCommand(
    argv: string[],
    { isExpoAdmin = false }: { isExpoAdmin?: boolean } = {}
  ): SimulatorAvailability {
    const command = new SimulatorAvailability(argv, mockConfig);
    // @ts-expect-error getContextAsync is protected
    jest.spyOn(command, 'getContextAsync').mockResolvedValue({
      projectId,
      loggedIn: { actor: { isExpoAdmin }, graphqlClient },
    });
    return command;
  }

  it('emits JSON with available true when enabled', async () => {
    mockByAppIdAsync.mockResolvedValue({ accountName: 'testuser', available: true });

    const command = createCommand(['--json']);
    await command.runAsync();

    expect(mockEnableJsonOutput).toHaveBeenCalled();
    expect(mockByAppIdAsync).toHaveBeenCalledWith(graphqlClient, projectId);
    expect(mockPrintJsonOnlyOutput).toHaveBeenCalledWith({
      available: true,
      accountName: 'testuser',
    });
  });

  it('emits JSON with available false and the waitlist URL when not enabled', async () => {
    mockByAppIdAsync.mockResolvedValue({ accountName: 'testuser', available: false });

    const command = createCommand(['--json']);
    await command.runAsync();

    expect(mockPrintJsonOnlyOutput).toHaveBeenCalledWith({
      available: false,
      accountName: 'testuser',
      waitlistUrl: EAS_SIMULATOR_WAITLIST_URL,
    });
  });

  it('omits the waitlist URL from JSON when enabled', async () => {
    mockByAppIdAsync.mockResolvedValue({ accountName: 'testuser', available: true });

    const command = createCommand(['--json']);
    await command.runAsync();

    expect(mockPrintJsonOnlyOutput).toHaveBeenCalledWith({
      available: true,
      accountName: 'testuser',
    });
  });

  it('emits JSON with available true for Expo admins when the account is gated', async () => {
    mockByAppIdAsync.mockResolvedValue({ accountName: 'testuser', available: false });

    const command = createCommand(['--json'], { isExpoAdmin: true });
    await command.runAsync();

    expect(mockByAppIdAsync).toHaveBeenCalledWith(graphqlClient, projectId);
    expect(mockPrintJsonOnlyOutput).toHaveBeenCalledWith({
      available: true,
      accountName: 'testuser',
    });
  });

  it('logs a graceful message pointing at the waitlist when not enabled', async () => {
    mockByAppIdAsync.mockResolvedValue({ accountName: 'testuser', available: false });

    const command = createCommand([]);
    await command.runAsync();

    expect(mockByAppIdAsync).toHaveBeenCalledWith(graphqlClient, projectId);
    expect(mockLog).toHaveBeenCalledWith(
      "EAS Simulator isn't available on testuser yet — it's coming soon.\n" +
        `Join the waitlist to get access: ${EAS_SIMULATOR_WAITLIST_URL}`
    );
    expect(mockPrintJsonOnlyOutput).not.toHaveBeenCalled();
  });

  it('logs the enabled message when available', async () => {
    mockByAppIdAsync.mockResolvedValue({ accountName: 'testuser', available: true });

    const command = createCommand([]);
    await command.runAsync();

    expect(mockLog).toHaveBeenCalledWith('✅ EAS Simulator is enabled for testuser.');
    expect(mockPrintJsonOnlyOutput).not.toHaveBeenCalled();
  });

  it('propagates a query failure', async () => {
    mockByAppIdAsync.mockRejectedValue(new Error('network down'));

    const command = createCommand([]);
    await expect(command.runAsync()).rejects.toThrow('network down');
  });
});
