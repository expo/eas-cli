import { Config } from '@oclif/core';

import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import {
  DeviceRunSessionEventsByIdQuery,
  DeviceRunSessionStatus,
} from '../../../graphql/generated';
import { DeviceRunSessionQuery } from '../../../graphql/queries/DeviceRunSessionQuery';
import Log from '../../../log';
import { loadSimulatorEnvAsync } from '../../../simulator/env';
import {
  type DeviceRunSessionEvent,
  downloadDeviceRunSessionEventsAsync,
  formatDeviceRunSessionEvent,
  projectDeviceRunSessionEventsForDisplay,
} from '../../../simulator/events';
import { enableJsonOutput, printJsonOnlyOutput } from '../../../utils/json';
import { sleepAsync } from '../../../utils/promise';
import SimulatorEvents from '../events';

jest.mock('../../../graphql/queries/DeviceRunSessionQuery');
jest.mock('../../../log');
jest.mock('../../../simulator/env', () => ({
  ...jest.requireActual('../../../simulator/env'),
  loadSimulatorEnvAsync: jest.fn(),
}));
jest.mock('../../../simulator/events');
jest.mock('../../../utils/json');
jest.mock('../../../utils/promise');

const mockEventsByIdAsync = jest.mocked(DeviceRunSessionQuery.eventsByIdAsync);
const mockDownloadEventsAsync = jest.mocked(downloadDeviceRunSessionEventsAsync);
const mockFormatEvent = jest.mocked(formatDeviceRunSessionEvent);
const mockLoadSimulatorEnvAsync = jest.mocked(loadSimulatorEnvAsync);
const mockEnableJsonOutput = jest.mocked(enableJsonOutput);
const mockPrintJsonOnlyOutput = jest.mocked(printJsonOnlyOutput);
const mockProjectEvents = jest.mocked(projectDeviceRunSessionEventsForDisplay);
const mockSleepAsync = jest.mocked(sleepAsync);
const mockLog = jest.mocked(Log.log);

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
    mockProjectEvents.mockImplementation(events => events);
    mockFormatEvent.mockImplementation(event => `formatted:${event.eventId}`);
    mockSleepAsync.mockResolvedValue();
  });

  it('prints a JSON snapshot for the requested session', async () => {
    const session: DeviceRunSessionEventsByIdQuery['deviceRunSessions']['byId'] = {
      id: 'session-id',
      status: DeviceRunSessionStatus.InProgress,
      artifacts: [
        {
          id: 'event-artifact-id',
          downloadUrl: 'https://example.test/events',
          metadata: { __eas_type: 'session-events' },
        },
      ],
    };
    const events = [
      {
        v: 1 as const,
        eventId: 'event-id',
        ts: '2026-07-10T12:00:00.000Z',
        producer: 'agent-device',
        type: 'operation.started',
        summary: 'Started tap',
      },
    ];
    mockEventsByIdAsync.mockResolvedValue(session);
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
    expect(mockEventsByIdAsync).toHaveBeenCalledWith(graphqlClient, 'session-id');
    expect(mockDownloadEventsAsync).toHaveBeenCalledWith('https://example.test/events');
    expect(mockPrintJsonOnlyOutput).toHaveBeenCalledWith({
      deviceRunSessionId: 'session-id',
      events,
    });
    expect(mockProjectEvents).not.toHaveBeenCalled();
  });

  it('prints an empty snapshot when the session has no event artifact', async () => {
    mockEventsByIdAsync.mockResolvedValue({
      id: 'session-id',
      status: DeviceRunSessionStatus.Stopped,
      artifacts: [],
    });
    const command = new SimulatorEvents(['--id', 'session-id', '--json'], getMockOclifConfig());
    // @ts-expect-error getContextAsync is protected
    jest.spyOn(command, 'getContextAsync').mockResolvedValue({
      loggedIn: { graphqlClient },
      projectDir,
    });

    await command.runAsync();

    expect(mockDownloadEventsAsync).not.toHaveBeenCalled();
    expect(mockPrintJsonOnlyOutput).toHaveBeenCalledWith({
      deviceRunSessionId: 'session-id',
      events: [],
    });
  });

  it('prints a condensed text snapshot', async () => {
    const session = createSession(DeviceRunSessionStatus.Stopped);
    const events = [createEvent()];
    mockEventsByIdAsync.mockResolvedValue(session);
    mockDownloadEventsAsync.mockResolvedValue(events);
    const command = createCommand(['--id', 'session-id']);

    await command.runAsync();

    expect(mockProjectEvents).toHaveBeenCalledWith(events, {
      includeIncompleteOperations: true,
    });
    expect(mockFormatEvent).toHaveBeenCalledWith(events[0]);
    expect(mockLog).toHaveBeenCalledWith('formatted:event-id');
  });

  it('refreshes twice after a followed running session stops before flushing incomplete events', async () => {
    const events = [createEvent()];
    mockEventsByIdAsync
      .mockResolvedValueOnce(createSession(DeviceRunSessionStatus.InProgress))
      .mockResolvedValueOnce(createSession(DeviceRunSessionStatus.Stopped))
      .mockResolvedValueOnce(createSession(DeviceRunSessionStatus.Stopped))
      .mockResolvedValueOnce(createSession(DeviceRunSessionStatus.Stopped));
    mockDownloadEventsAsync.mockResolvedValue(events);
    mockProjectEvents.mockImplementation((projectedEvents, options) =>
      options?.includeIncompleteOperations ? projectedEvents : []
    );
    const command = createCommand(['--id', 'session-id', '--follow']);

    await command.runAsync();

    expect(mockEventsByIdAsync).toHaveBeenCalledTimes(4);
    expect(mockDownloadEventsAsync).toHaveBeenCalledTimes(4);
    expect(mockSleepAsync).toHaveBeenCalledTimes(3);
    expect(
      mockProjectEvents.mock.calls.map(([, options]) => options?.includeIncompleteOperations)
    ).toEqual([false, false, false, true]);
    expect(mockLog).toHaveBeenCalledTimes(1);
    expect(mockLog).toHaveBeenCalledWith('formatted:event-id');
  });

  it('removes its interrupt listener when follow mode is interrupted', async () => {
    const existingInterruptListeners = new Set(process.listeners('SIGINT'));
    mockEventsByIdAsync.mockResolvedValue(createSession(DeviceRunSessionStatus.InProgress));
    mockDownloadEventsAsync.mockResolvedValue([]);
    mockSleepAsync.mockImplementationOnce(async () => {
      const interruptHandler = process
        .listeners('SIGINT')
        .find(listener => !existingInterruptListeners.has(listener));
      expect(interruptHandler).toBeDefined();
      interruptHandler?.('SIGINT');
    });
    const command = createCommand(['--id', 'session-id', '--follow']);

    await command.runAsync();

    expect(mockEventsByIdAsync).toHaveBeenCalledTimes(1);
    expect(process.listeners('SIGINT')).toEqual([...existingInterruptListeners]);
  });

  it('rejects combining JSON and follow output', async () => {
    const command = new SimulatorEvents(
      ['--id', 'session-id', '--json', '--follow'],
      getMockOclifConfig()
    );

    await expect(command.runAsync()).rejects.toThrow('Use either --json or --follow, not both.');
  });
});

function createCommand(args: string[]): SimulatorEvents {
  const command = new SimulatorEvents(args, getMockOclifConfig());
  // @ts-expect-error getContextAsync is protected
  jest.spyOn(command, 'getContextAsync').mockResolvedValue({
    loggedIn: { graphqlClient: {} as ExpoGraphqlClient },
    projectDir: '/test/project',
  });
  return command;
}

function createSession(
  status: DeviceRunSessionStatus
): DeviceRunSessionEventsByIdQuery['deviceRunSessions']['byId'] {
  return {
    id: 'session-id',
    status,
    artifacts: [
      {
        id: 'event-artifact-id',
        downloadUrl: 'https://example.test/events',
        metadata: { __eas_type: 'session-events' },
      },
    ],
  };
}

function createEvent(): DeviceRunSessionEvent {
  return {
    v: 1 as const,
    eventId: 'event-id',
    ts: '2026-07-10T12:00:00.000Z',
    producer: 'agent-device',
    type: 'operation.started',
    summary: 'Started tap',
  };
}
