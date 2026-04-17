import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { getMockOclifConfig } from '../../../__tests__/commands/utils';
import { UpdateInsightsQuery } from '../../../graphql/queries/UpdateInsightsQuery';
import { UpdateQuery } from '../../../graphql/queries/UpdateQuery';
import Log from '../../../log';
import { enableJsonOutput, printJsonOnlyOutput } from '../../../utils/json';
import UpdateView from '../view';

jest.mock('../../../graphql/queries/UpdateQuery', () => ({
  UpdateQuery: { viewUpdateGroupAsync: jest.fn() },
}));
jest.mock('../../../graphql/queries/UpdateInsightsQuery', () => ({
  UpdateInsightsQuery: { viewUpdateGroupInsightsAsync: jest.fn() },
}));
jest.mock('../../../log');
jest.mock('../../../utils/json');

const mockViewUpdateGroupAsync = jest.mocked(UpdateQuery.viewUpdateGroupAsync);
const mockViewUpdateGroupInsightsAsync = jest.mocked(
  UpdateInsightsQuery.viewUpdateGroupInsightsAsync
);
const mockEnableJsonOutput = jest.mocked(enableJsonOutput);
const mockPrintJsonOnlyOutput = jest.mocked(printJsonOnlyOutput);
const mockLogLog = jest.mocked(Log.log);

const updateGroup = [
  {
    __typename: 'Update' as const,
    id: 'u1',
    group: 'group-1',
    branch: { __typename: 'UpdateBranch' as const, id: 'b1', name: 'main' },
    actor: null,
    createdAt: '2026-04-09T00:00:00.000Z',
    message: 'first',
    runtimeVersion: '1.0.0',
    platform: 'ios',
    manifestPermalink: 'https://expo.dev/manifest/u1',
    isRollBackToEmbedded: false,
    rolloutPercentage: null,
    codeSigningInfo: null,
    gitCommitHash: null,
  } as any,
];

function makeUpdateWithInsights(platform: 'ios' | 'android', totalInstalls = 990): any {
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

const insightsResponse = [makeUpdateWithInsights('ios', 990)];

describe(UpdateView, () => {
  const graphqlClient = {} as ExpoGraphqlClient;
  const mockConfig = getMockOclifConfig();

  beforeEach(() => {
    jest.clearAllMocks();
    mockViewUpdateGroupAsync.mockResolvedValue(updateGroup);
    mockViewUpdateGroupInsightsAsync.mockResolvedValue(insightsResponse);
  });

  function createCommand(argv: string[]): UpdateView {
    const command = new UpdateView(argv, mockConfig);
    // @ts-expect-error getContextAsync is protected
    jest.spyOn(command, 'getContextAsync').mockResolvedValue({
      loggedIn: { graphqlClient },
    });
    return command;
  }

  it('does not fetch insights when --insights is not set', async () => {
    const command = createCommand(['group-1']);
    await command.runAsync();
    expect(mockViewUpdateGroupInsightsAsync).not.toHaveBeenCalled();
  });

  it('rejects --days without --insights', async () => {
    const command = createCommand(['group-1', '--days', '7']);
    await expect(command.runAsync()).rejects.toThrow(/--insights/);
  });

  it('rejects --start without --insights', async () => {
    const command = createCommand(['group-1', '--start', '2026-04-01']);
    await expect(command.runAsync()).rejects.toThrow(/--insights/);
  });

  it('fetches insights when --insights is set', async () => {
    const command = createCommand(['group-1', '--insights']);
    await command.runAsync();
    expect(mockViewUpdateGroupInsightsAsync).toHaveBeenCalledWith(
      graphqlClient,
      expect.objectContaining({ groupId: 'group-1' })
    );
  });

  it('outputs flat update array under --json without --insights', async () => {
    const command = createCommand(['group-1', '--json']);
    await command.runAsync();
    expect(mockEnableJsonOutput).toHaveBeenCalled();
    const arg = mockPrintJsonOnlyOutput.mock.calls[0][0];
    expect(Array.isArray(arg)).toBe(true);
  });

  it('renders an insights section in the table output when --insights is set without --json', async () => {
    const command = createCommand(['group-1', '--insights']);
    await command.runAsync();
    const logged = mockLogLog.mock.calls.map(call => String(call[0] ?? '')).join('\n');
    expect(logged).toMatch(/Update group insights/);
  });

  it('wraps output as { updates, insights } under --json --insights', async () => {
    const command = createCommand(['group-1', '--json', '--insights']);
    await command.runAsync();
    const arg = mockPrintJsonOnlyOutput.mock.calls[0][0] as any;
    expect(arg.updates).toBeDefined();
    expect(arg.insights).toBeDefined();
    expect(arg.insights.platforms[0].totals.installs).toBe(990);
  });
});
