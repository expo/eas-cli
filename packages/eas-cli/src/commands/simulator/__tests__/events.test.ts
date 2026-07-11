import { Config } from '@oclif/core';

import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import {
  DeviceRunSessionEventLogByIdQuery,
  DeviceRunSessionStatus,
} from '../../../graphql/generated';
import { DeviceRunSessionQuery } from '../../../graphql/queries/DeviceRunSessionQuery';
import { loadSimulatorEnvAsync } from '../../../simulator/env';
import { downloadDeviceRunSessionEventsAsync } from '../../../simulator/events';
import { enableJsonOutput, printJsonOnlyOutput } from '../../../utils/json';
import SimulatorEvents from '../events';

jest.mock('../../../graphql/queries/DeviceRunSessionQuery');
jest.mock('../../../log');
jest.mock('../../../simulator/env', () => ({
  ...jest.requireActual('../../../simulator/env'),
  loadSimulatorEnvAsync: jest.fn(),
}));
jest.mock('../../../simulator/events');
jest.mock('../../../utils/json');

const mockEventLogByIdAsync = jest.mocked(DeviceRunSessionQuery.eventLogByIdAsync);
const mockDownloadEventsAsync = jest.mocked(downloadDeviceRunSessionEventsAsync);
const mockLoadSimulatorEnvAsync = jest.mocked(loadSimulatorEnvAsync);
const mockEnableJsonOutput = jest.mocked(enableJsonOutput);
const mockPrintJsonOnlyOutput = jest.mocked(printJsonOnlyOutput);

function getMockOclifConfig(): Config {
  const config = new Config({ root: __dirname });
  config.runHook = async () => ({ failures: [], successes: [] });
  return config;
}

describe(SimulatorEvents, () => {
  const graphqlClient = {} as ExpoGraphqlClient;
  const projectDir = '/test/project';

  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadSimulatorEnvAsync.mockResolvedValue();
  });

  it('prints a JSON snapshot for the requested session', async () => {
    const session: DeviceRunSessionEventLogByIdQuery['deviceRunSessions']['byId'] = {
      id: 'session-id',
      status: DeviceRunSessionStatus.InProgress,
      eventLog: { fileUrl: 'https://example.test/events' },
    };
    const events = [
      {
        schemaVersion: 1 as const,
        eventId: 'event-id',
        deviceRunSessionId: 'session-id',
        occurredAt: '2026-07-10T12:00:00.000Z',
        producer: 'agent-device',
        type: 'operation.started',
        summary: 'Started tap',
      },
    ];
    mockEventLogByIdAsync.mockResolvedValue(session);
    mockDownloadEventsAsync.mockResolvedValue(events);
    const command = new SimulatorEvents(['--id', 'session-id', '--json'], getMockOclifConfig());
    // @ts-expect-error getContextAsync is protected
    jest.spyOn(command, 'getContextAsync').mockResolvedValue({
      loggedIn: { graphqlClient },
      projectDir,
    });

    await command.runAsync();

    expect(mockEnableJsonOutput).toHaveBeenCalled();
    expect(mockLoadSimulatorEnvAsync).toHaveBeenCalledWith(projectDir);
    expect(mockEventLogByIdAsync).toHaveBeenCalledWith(graphqlClient, 'session-id');
    expect(mockDownloadEventsAsync).toHaveBeenCalledWith(
      'https://example.test/events',
      'session-id'
    );
    expect(mockPrintJsonOnlyOutput).toHaveBeenCalledWith({
      deviceRunSessionId: 'session-id',
      events,
    });
  });
});
