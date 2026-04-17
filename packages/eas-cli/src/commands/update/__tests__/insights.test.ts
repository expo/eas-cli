import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { getMockOclifConfig } from '../../../__tests__/commands/utils';
import { UpdateInsightsQuery } from '../../../graphql/queries/UpdateInsightsQuery';
import { enableJsonOutput, printJsonOnlyOutput } from '../../../utils/json';
import UpdateInsights from '../insights';

jest.mock('../../../graphql/queries/UpdateInsightsQuery', () => ({
  UpdateInsightsQuery: { viewUpdateGroupInsightsAsync: jest.fn() },
}));
jest.mock('../../../log');
jest.mock('../../../utils/json');

const mockViewUpdateGroupInsightsAsync = jest.mocked(
  UpdateInsightsQuery.viewUpdateGroupInsightsAsync
);
const mockEnableJsonOutput = jest.mocked(enableJsonOutput);
const mockPrintJsonOnlyOutput = jest.mocked(printJsonOnlyOutput);

function makeUpdateResponse(platform: 'ios' | 'android', totalInstalls = 990): any {
  return {
    __typename: 'Update',
    id: `${platform}-update`,
    platform,
    insights: {
      __typename: 'UpdateInsights',
      id: `${platform}-i`,
      totalUniqueUsers: 100,
      cumulativeAverageMetrics: {
        __typename: 'CumulativeAverageMetrics',
        launchAssetCount: 3,
        averageUpdatePayloadBytes: 1024,
      },
      cumulativeMetrics: {
        __typename: 'CumulativeMetrics',
        metricsAtLastTimestamp: {
          __typename: 'CumulativeMetricsTotals',
          totalInstalls,
          totalFailedInstalls: 10,
        },
        data: {
          __typename: 'UpdatesMetricsData',
          labels: ['2026-04-09'],
          installsDataset: {
            __typename: 'CumulativeUpdatesDataset',
            id: `${platform}-i`,
            label: 'Installs',
            cumulative: [totalInstalls],
            difference: [totalInstalls],
          },
          failedInstallsDataset: {
            __typename: 'CumulativeUpdatesDataset',
            id: `${platform}-f`,
            label: 'Failed installs',
            cumulative: [10],
            difference: [10],
          },
        },
      },
    },
  };
}

const updatesResponse = [makeUpdateResponse('android', 500), makeUpdateResponse('ios', 990)];

describe(UpdateInsights, () => {
  const graphqlClient = {} as ExpoGraphqlClient;
  const mockConfig = getMockOclifConfig();

  beforeEach(() => {
    jest.clearAllMocks();
    mockViewUpdateGroupInsightsAsync.mockResolvedValue(updatesResponse);
  });

  function createCommand(argv: string[]): UpdateInsights {
    const command = new UpdateInsights(argv, mockConfig);
    // @ts-expect-error getContextAsync is protected
    jest.spyOn(command, 'getContextAsync').mockResolvedValue({
      loggedIn: { graphqlClient },
    });
    return command;
  }

  it('uses default 7-day window when --days/--start/--end are not provided', async () => {
    const now = new Date('2026-04-16T12:00:00.000Z');
    jest.useFakeTimers({ now });

    const command = createCommand(['group-1']);
    await command.runAsync();

    expect(mockViewUpdateGroupInsightsAsync).toHaveBeenCalledWith(
      graphqlClient,
      expect.objectContaining({
        groupId: 'group-1',
        startTime: '2026-04-09T12:00:00.000Z',
        endTime: '2026-04-16T12:00:00.000Z',
      })
    );

    jest.useRealTimers();
  });

  it('uses --days when explicitly provided', async () => {
    const now = new Date('2026-04-16T12:00:00.000Z');
    jest.useFakeTimers({ now });

    const command = createCommand(['group-1', '--days', '14']);
    await command.runAsync();

    expect(mockViewUpdateGroupInsightsAsync).toHaveBeenCalledWith(
      graphqlClient,
      expect.objectContaining({
        startTime: '2026-04-02T12:00:00.000Z',
        endTime: '2026-04-16T12:00:00.000Z',
      })
    );

    jest.useRealTimers();
  });

  it('uses --start and --end when provided', async () => {
    const command = createCommand([
      'group-1',
      '--start',
      '2026-01-01T00:00:00.000Z',
      '--end',
      '2026-02-01T00:00:00.000Z',
    ]);
    await command.runAsync();

    expect(mockViewUpdateGroupInsightsAsync).toHaveBeenCalledWith(
      graphqlClient,
      expect.objectContaining({
        startTime: '2026-01-01T00:00:00.000Z',
        endTime: '2026-02-01T00:00:00.000Z',
      })
    );
  });

  it('rejects --days combined with --start', async () => {
    const command = createCommand([
      'group-1',
      '--days',
      '7',
      '--start',
      '2026-01-01T00:00:00.000Z',
    ]);
    await expect(command.runAsync()).rejects.toThrow();
  });

  it('filters to a single platform when --platform is passed', async () => {
    const command = createCommand(['group-1', '--platform', 'ios', '--json', '--non-interactive']);
    await command.runAsync();

    const json = mockPrintJsonOnlyOutput.mock.calls[0][0] as any;
    expect(json.platforms.map((p: any) => p.platform)).toEqual(['ios']);
  });

  it('throws when --platform does not match any update in the group', async () => {
    mockViewUpdateGroupInsightsAsync.mockResolvedValue([makeUpdateResponse('android', 500)]);
    const command = createCommand(['group-1', '--platform', 'ios']);
    await expect(command.runAsync()).rejects.toThrow(/no ios update/);
  });

  it('emits JSON when --json is passed', async () => {
    const command = createCommand(['group-1', '--json', '--non-interactive']);
    await command.runAsync();

    expect(mockEnableJsonOutput).toHaveBeenCalled();
    const json = mockPrintJsonOnlyOutput.mock.calls[0][0] as any;
    expect(json.groupId).toBe('group-1');
    expect(json.platforms.map((p: any) => p.platform)).toEqual(['android', 'ios']);
    expect(json.platforms[0].totals.installs).toBe(500);
    expect(json.platforms[1].totals.installs).toBe(990);
  });
});
