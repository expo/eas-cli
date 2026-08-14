import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { getMockOclifConfig } from '../../../__tests__/commands/utils';
import { ChannelInsightsQuery } from '../../../graphql/queries/ChannelInsightsQuery';
import { enableJsonOutput, printJsonOnlyOutput } from '../../../utils/json';
import ChannelInsights from '../insights';

jest.mock('../../../graphql/queries/ChannelInsightsQuery', () => ({
  ChannelInsightsQuery: { viewChannelRuntimeInsightsAsync: jest.fn() },
}));
jest.mock('../../../log');
jest.mock('../../../utils/json');

const mockViewChannelRuntimeInsightsAsync = jest.mocked(
  ChannelInsightsQuery.viewChannelRuntimeInsightsAsync
);
const mockEnableJsonOutput = jest.mocked(enableJsonOutput);
const mockPrintJsonOnlyOutput = jest.mocked(printJsonOnlyOutput);

const insightsResponse = {
  __typename: 'UpdateChannelRuntimeInsights' as const,
  id: 'rti',
  embeddedUpdateTotalUniqueUsers: 50,
  mostPopularUpdates: [
    {
      __typename: 'Update' as const,
      id: 'u1',
      group: 'group-a',
      message: 'first',
      runtimeVersion: '1.0.0',
      platform: 'ios',
      insights: { __typename: 'UpdateInsights' as const, id: 'u1-i', totalUniqueUsers: 200 },
    },
  ],
  uniqueUsersOverTime: {
    __typename: 'UniqueUsersOverTimeData' as const,
    data: {
      __typename: 'LineChartData' as const,
      labels: ['2026-04-09'],
      datasets: [{ __typename: 'LineDataset' as const, id: 'd1', label: 'iOS', data: [50] }],
    },
  },
  cumulativeMetricsOverTime: {
    __typename: 'ChannelRuntimeCumulativeMetricsOverTimeData' as const,
    data: {
      __typename: 'LineChartData' as const,
      labels: ['2026-04-09'],
      datasets: [{ __typename: 'LineDataset' as const, id: 'cd1', label: 'Launches', data: [42] }],
    },
    metricsAtLastTimestamp: [
      { __typename: 'LineDatapoint' as const, id: 'launches', label: 'Launches', data: 42 },
    ],
  },
};

describe(ChannelInsights, () => {
  const graphqlClient = {} as ExpoGraphqlClient;
  const mockConfig = getMockOclifConfig();
  const projectId = 'project-1';

  beforeEach(() => {
    jest.clearAllMocks();
    mockViewChannelRuntimeInsightsAsync.mockResolvedValue(insightsResponse);
  });

  function createCommand(argv: string[]): ChannelInsights {
    const command = new ChannelInsights(argv, mockConfig);
    // @ts-expect-error getContextAsync is protected
    jest.spyOn(command, 'getContextAsync').mockResolvedValue({
      projectId,
      loggedIn: { graphqlClient },
    });
    return command;
  }

  it('passes appId, channel, runtimeVersion and default 7-day timespan to the query', async () => {
    const now = new Date('2026-04-16T12:00:00.000Z');
    jest.useFakeTimers({ now });

    const command = createCommand(['--channel', 'production', '--runtime-version', '1.0.0']);
    await command.runAsync();

    expect(mockViewChannelRuntimeInsightsAsync).toHaveBeenCalledWith(graphqlClient, {
      appId: projectId,
      channelName: 'production',
      runtimeVersion: '1.0.0',
      startTime: '2026-04-09T12:00:00.000Z',
      endTime: '2026-04-16T12:00:00.000Z',
    });

    jest.useRealTimers();
  });

  it('emits JSON when --json is passed', async () => {
    const command = createCommand([
      '--channel',
      'production',
      '--runtime-version',
      '1.0.0',
      '--json',
      '--non-interactive',
    ]);
    await command.runAsync();

    expect(mockEnableJsonOutput).toHaveBeenCalled();
    expect(mockPrintJsonOnlyOutput).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'production',
        runtimeVersion: '1.0.0',
        embeddedUpdateTotalUniqueUsers: 50,
      })
    );
  });

  it('requires --channel and --runtime-version', async () => {
    const command = createCommand([]);
    await expect(command.runAsync()).rejects.toThrow();
  });
});
