import { CombinedError } from '@urql/core';
import { GraphQLError } from 'graphql';

import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { getMockOclifConfig } from '../../../__tests__/commands/utils';
import {
  AppObservePlatform,
  AppObserveSpanKind,
  AppObserveSpanStatusCode,
} from '../../../graphql/generated';
import { ObserveQuery } from '../../../graphql/queries/ObserveQuery';
import { fetchObserveSpansAsync } from '../../../observe/fetchSpans';
import {
  buildObserveSpanNamesJson,
  buildObserveSpanNamesTable,
  buildObserveSpansJson,
  buildObserveSpansTable,
} from '../../../observe/formatSpans';
import { EAS_OBSERVE_PLAN_UPGRADE_REQUIRED_ERROR_CODE } from '../../../observe/planGating';
import { enableJsonOutput, printJsonOnlyOutput } from '../../../utils/json';
import ObserveTraces from '../traces';

jest.mock('../../../observe/fetchSpans');
jest.mock('../../../observe/formatSpans', () => ({
  buildObserveSpansTable: jest.fn().mockReturnValue('spans-table'),
  buildObserveSpansJson: jest.fn().mockReturnValue({ spans: [] }),
  buildObserveSpanNamesTable: jest.fn().mockReturnValue('names-table'),
  buildObserveSpanNamesJson: jest.fn().mockReturnValue({ names: [], isTruncated: false }),
}));
jest.mock('../../../graphql/queries/ObserveQuery', () => ({
  ObserveQuery: {
    spanNamesAsync: jest.fn(),
  },
}));
jest.mock('../../../log');
jest.mock('../../../utils/json');

const mockFetchObserveSpansAsync = jest.mocked(fetchObserveSpansAsync);
const mockSpanNamesAsync = jest.mocked(ObserveQuery.spanNamesAsync);
const mockBuildObserveSpansTable = jest.mocked(buildObserveSpansTable);
const mockBuildObserveSpansJson = jest.mocked(buildObserveSpansJson);
const mockBuildObserveSpanNamesTable = jest.mocked(buildObserveSpanNamesTable);
const mockBuildObserveSpanNamesJson = jest.mocked(buildObserveSpanNamesJson);
const mockEnableJsonOutput = jest.mocked(enableJsonOutput);
const mockPrintJsonOnlyOutput = jest.mocked(printJsonOnlyOutput);

describe(ObserveTraces, () => {
  const graphqlClient = {} as any as ExpoGraphqlClient;
  const mockConfig = getMockOclifConfig();
  const projectId = 'test-project-id';

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchObserveSpansAsync.mockResolvedValue({
      spans: [],
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
    });
    mockSpanNamesAsync.mockResolvedValue({ names: [], isTruncated: false });
  });

  function createCommand(argv: string[]): ObserveTraces {
    const command = new ObserveTraces(argv, mockConfig);
    // @ts-expect-error
    jest.spyOn(command, 'getContextAsync').mockReturnValue({
      projectId,
      loggedIn: { graphqlClient },
    });
    return command;
  }

  function planGateError(): CombinedError {
    const serverMessage =
      'Access to this feature is not included in your current plan. ' +
      'Upgrade your plan: https://expo.dev/accounts/acme/settings/billing';
    return new CombinedError({
      graphQLErrors: [
        new GraphQLError(serverMessage, null, null, null, null, null, {
          errorCode: EAS_OBSERVE_PLAN_UPGRADE_REQUIRED_ERROR_CODE,
        }),
      ],
    });
  }

  it('shows the span names summary when no span filter is given', async () => {
    const command = createCommand(['--days', '7', '--platform', 'ios', '--environment', 'prod']);
    await command.runAsync();

    expect(mockSpanNamesAsync).toHaveBeenCalledTimes(1);
    const variables = mockSpanNamesAsync.mock.calls[0][1];
    expect(variables.appId).toBe(projectId);
    expect(variables.input.platforms).toEqual([AppObservePlatform.Ios]);
    expect(variables.input.environment).toBe('prod');
    expect(variables.input.startTime).toBeDefined();
    expect(variables.input.endTime).toBeDefined();
    expect(mockFetchObserveSpansAsync).not.toHaveBeenCalled();
    expect(mockBuildObserveSpanNamesTable).toHaveBeenCalled();
    expect(mockBuildObserveSpansTable).not.toHaveBeenCalled();
  });

  it('passes release filters to the summary', async () => {
    const command = createCommand([
      '--app-version',
      '1.2.0',
      '--build-number',
      '42',
      '--update-id',
      'update-1',
    ]);
    await command.runAsync();

    const { input } = mockSpanNamesAsync.mock.calls[0][1];
    expect(input.appVersion).toBe('1.2.0');
    expect(input.appBuildNumber).toBe('42');
    expect(input.appUpdateId).toBe('update-1');
  });

  it('emits the summary as JSON with --json', async () => {
    const command = createCommand(['--json', '--non-interactive']);
    await command.runAsync();

    expect(mockEnableJsonOutput).toHaveBeenCalled();
    expect(mockBuildObserveSpanNamesJson).toHaveBeenCalled();
    expect(mockPrintJsonOnlyOutput).toHaveBeenCalled();
    expect(mockBuildObserveSpanNamesTable).not.toHaveBeenCalled();
  });

  it('lists spans with --all-spans', async () => {
    const command = createCommand(['--all-spans']);
    await command.runAsync();

    expect(mockSpanNamesAsync).not.toHaveBeenCalled();
    expect(mockFetchObserveSpansAsync).toHaveBeenCalledTimes(1);
    expect(mockBuildObserveSpansTable).toHaveBeenCalled();
  });

  it('lists spans when paging with --after', async () => {
    const command = createCommand(['--after', 'cursor-1']);
    await command.runAsync();

    expect(mockSpanNamesAsync).not.toHaveBeenCalled();
    expect(mockFetchObserveSpansAsync.mock.calls[0][2].after).toBe('cursor-1');
  });

  it.each([
    ['--name', 'GET'],
    ['--kind', 'client'],
    ['--status', 'error'],
    ['--host', 'api.example.com'],
    ['--http-status', '500'],
    ['--min-duration', '100'],
    ['--session-id', 'session-1'],
  ])('lists spans when %s is given', async (flag, value) => {
    const command = createCommand([flag, value]);
    await command.runAsync();

    expect(mockSpanNamesAsync).not.toHaveBeenCalled();
    expect(mockFetchObserveSpansAsync).toHaveBeenCalledTimes(1);
  });

  it('lists spans with --root-only', async () => {
    const command = createCommand(['--root-only']);
    await command.runAsync();

    expect(mockSpanNamesAsync).not.toHaveBeenCalled();
    expect(mockFetchObserveSpansAsync.mock.calls[0][2].rootOnly).toBe(true);
  });

  it('maps every span filter flag to the fetch options', async () => {
    const command = createCommand([
      '--name',
      'GET',
      '--name',
      'POST',
      '--kind',
      'client',
      '--status',
      'error',
      '--status',
      'unset',
      '--host',
      'api.example.com',
      '--http-status',
      '500',
      '--http-status',
      '502',
      '--min-duration',
      '250',
      '--root-only',
      '--session-id',
      'session-1',
      '--platform',
      'android',
      '--app-version',
      '1.2.0',
      '--build-number',
      '42',
      '--update-id',
      'update-1',
      '--environment',
      'prod',
      '--limit',
      '50',
    ]);
    await command.runAsync();

    const options = mockFetchObserveSpansAsync.mock.calls[0][2];
    expect(options).toEqual(
      expect.objectContaining({
        limit: 50,
        names: ['GET', 'POST'],
        kinds: [AppObserveSpanKind.Client],
        statusCodes: [AppObserveSpanStatusCode.Error, AppObserveSpanStatusCode.Unset],
        hosts: ['api.example.com'],
        httpStatusCodes: [500, 502],
        minDurationMs: 250,
        rootOnly: true,
        sessionId: 'session-1',
        platforms: [AppObservePlatform.Android],
        appVersion: '1.2.0',
        buildNumber: '42',
        updateId: 'update-1',
        environment: 'prod',
      })
    );
  });

  it('defaults the span list limit to 20 and caps it at 100', async () => {
    await createCommand(['--all-spans']).runAsync();
    expect(mockFetchObserveSpansAsync.mock.calls[0][2].limit).toBe(20);

    await expect(createCommand(['--all-spans', '--limit', '101']).runAsync()).rejects.toThrow();
  });

  it('rejects an unknown --kind or --status value', async () => {
    await expect(createCommand(['--kind', 'bogus']).runAsync()).rejects.toThrow();
    await expect(createCommand(['--status', 'bogus']).runAsync()).rejects.toThrow();
  });

  it('emits the span list as JSON with --json', async () => {
    const command = createCommand(['--all-spans', '--json', '--non-interactive']);
    await command.runAsync();

    expect(mockEnableJsonOutput).toHaveBeenCalled();
    expect(mockBuildObserveSpansJson).toHaveBeenCalled();
    expect(mockPrintJsonOnlyOutput).toHaveBeenCalled();
    expect(mockBuildObserveSpansTable).not.toHaveBeenCalled();
  });

  it('surfaces the plan-gate message when a session filter is not available on the plan', async () => {
    mockFetchObserveSpansAsync.mockRejectedValueOnce(planGateError());
    const command = createCommand(['--session-id', 'session-1']);
    await expect(command.runAsync()).rejects.toThrow(/not included in your current plan/);
  });

  it('surfaces the plan-gate message from the summary query', async () => {
    mockSpanNamesAsync.mockRejectedValueOnce(planGateError());
    const command = createCommand([]);
    await expect(command.runAsync()).rejects.toThrow(/not included in your current plan/);
  });
});
