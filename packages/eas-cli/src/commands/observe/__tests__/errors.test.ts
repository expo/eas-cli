import { CombinedError } from '@urql/core';
import { GraphQLError } from 'graphql';

import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { getMockOclifConfig } from '../../../__tests__/commands/utils';
import { AppObserveErrorSeverity } from '../../../graphql/generated';
import {
  fetchObserveErrorGroupsAsync,
  fetchObserveErrorOccurrencesAsync,
} from '../../../observe/fetchErrors';
import {
  buildObserveErrorGroupsJson,
  buildObserveErrorGroupsTable,
  buildObserveErrorOccurrencesJson,
  buildObserveErrorOccurrencesTable,
} from '../../../observe/formatErrors';
import { EAS_OBSERVE_FEATURE_NOT_AVAILABLE_IN_FREE_TIER_ERROR_CODE } from '../../../observe/planGating';
import { enableJsonOutput, printJsonOnlyOutput } from '../../../utils/json';
import ObserveErrors from '../errors';

jest.mock('../../../observe/fetchErrors');
jest.mock('../../../observe/formatErrors', () => ({
  buildObserveErrorGroupsTable: jest.fn().mockReturnValue('errors-table'),
  buildObserveErrorGroupsJson: jest.fn().mockReturnValue({ errors: [], isTruncated: false }),
  buildObserveErrorOccurrencesTable: jest.fn().mockReturnValue('occurrences-table'),
  buildObserveErrorOccurrencesJson: jest
    .fn()
    .mockReturnValue({ occurrences: [], pageInfo: { hasNextPage: false, endCursor: null } }),
}));
jest.mock('../../../log');
jest.mock('../../../utils/json');

const mockFetchErrorGroupsAsync = jest.mocked(fetchObserveErrorGroupsAsync);
const mockFetchErrorOccurrencesAsync = jest.mocked(fetchObserveErrorOccurrencesAsync);
const mockBuildTable = jest.mocked(buildObserveErrorGroupsTable);
const mockBuildJson = jest.mocked(buildObserveErrorGroupsJson);
const mockBuildOccurrencesTable = jest.mocked(buildObserveErrorOccurrencesTable);
const mockBuildOccurrencesJson = jest.mocked(buildObserveErrorOccurrencesJson);
const mockEnableJsonOutput = jest.mocked(enableJsonOutput);
const mockPrintJsonOnlyOutput = jest.mocked(printJsonOnlyOutput);

describe(ObserveErrors, () => {
  const graphqlClient = {} as any as ExpoGraphqlClient;
  const mockConfig = getMockOclifConfig();
  const projectId = 'test-project-id';

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchErrorGroupsAsync.mockResolvedValue({ groups: [], isTruncated: false });
    mockFetchErrorOccurrencesAsync.mockResolvedValue({
      occurrences: [],
      pageInfo: { hasNextPage: false, hasPreviousPage: false, endCursor: null } as any,
    });
  });

  function createCommand(argv: string[]): ObserveErrors {
    const command = new ObserveErrors(argv, mockConfig);
    // @ts-expect-error
    jest.spyOn(command, 'getContextAsync').mockReturnValue({
      projectId,
      loggedIn: { graphqlClient },
    });
    return command;
  }

  it('fetches error groups and renders a table by default', async () => {
    await createCommand([]).runAsync();
    expect(mockFetchErrorGroupsAsync).toHaveBeenCalledTimes(1);
    expect(mockBuildTable).toHaveBeenCalledTimes(1);
    expect(mockEnableJsonOutput).not.toHaveBeenCalled();
  });

  it('emits JSON with --json', async () => {
    await createCommand(['--json', '--non-interactive']).runAsync();
    expect(mockEnableJsonOutput).toHaveBeenCalledTimes(1);
    expect(mockBuildJson).toHaveBeenCalledTimes(1);
    expect(mockPrintJsonOnlyOutput).toHaveBeenCalledWith({ errors: [], isTruncated: false });
  });

  it('maps the --severity flag to the AppObserveErrorSeverity enum', async () => {
    await createCommand(['--severity', 'fatal']).runAsync();
    const options = mockFetchErrorGroupsAsync.mock.calls[0][2];
    expect(options.severity).toBe(AppObserveErrorSeverity.Fatal);
  });

  it('fetches occurrences (not groups) and renders their table when --fingerprint is set', async () => {
    await createCommand(['--fingerprint', 'fp-1']).runAsync();
    expect(mockFetchErrorGroupsAsync).not.toHaveBeenCalled();
    expect(mockFetchErrorOccurrencesAsync).toHaveBeenCalledTimes(1);
    expect(mockFetchErrorOccurrencesAsync.mock.calls[0][2]).toMatchObject({ fingerprint: 'fp-1' });
    expect(mockBuildOccurrencesTable).toHaveBeenCalledTimes(1);
    expect(mockBuildTable).not.toHaveBeenCalled();
  });

  it('emits occurrences JSON with --fingerprint --json', async () => {
    await createCommand(['--fingerprint', 'fp-1', '--json', '--non-interactive']).runAsync();
    expect(mockEnableJsonOutput).toHaveBeenCalledTimes(1);
    expect(mockBuildOccurrencesJson).toHaveBeenCalledTimes(1);
    expect(mockPrintJsonOnlyOutput).toHaveBeenCalledWith({
      occurrences: [],
      pageInfo: { hasNextPage: false, endCursor: null },
    });
  });

  it('forwards --limit to the occurrences fetch when --fingerprint is set', async () => {
    await createCommand(['--fingerprint', 'fp-1', '--limit', '20']).runAsync();
    expect(mockFetchErrorOccurrencesAsync.mock.calls[0][2]).toMatchObject({
      fingerprint: 'fp-1',
      limit: 20,
    });
  });

  it('rejects --limit without --fingerprint', async () => {
    await expect(createCommand(['--limit', '20']).runAsync()).rejects.toThrow(
      /--after or --limit can only be used in combination with the --fingerprint flag/
    );
    expect(mockFetchErrorGroupsAsync).not.toHaveBeenCalled();
    expect(mockFetchErrorOccurrencesAsync).not.toHaveBeenCalled();
  });

  it('rejects --after without --fingerprint', async () => {
    await expect(createCommand(['--after', 'cursor-1']).runAsync()).rejects.toThrow(
      /--after or --limit can only be used in combination with the --fingerprint flag/
    );
    expect(mockFetchErrorGroupsAsync).not.toHaveBeenCalled();
  });

  it('surfaces the plan-gate message when errors are not available on the plan', async () => {
    mockFetchErrorGroupsAsync.mockRejectedValueOnce(
      new CombinedError({
        graphQLErrors: [
          new GraphQLError(
            'Subscription to EAS is required for this feature.',
            null,
            null,
            null,
            null,
            null,
            {
              errorCode: EAS_OBSERVE_FEATURE_NOT_AVAILABLE_IN_FREE_TIER_ERROR_CODE,
            }
          ),
        ],
      })
    );
    await expect(createCommand([]).runAsync()).rejects.toThrow(/Subscription to EAS is required/);
  });
});
