import { CombinedError } from '@urql/core';
import { GraphQLError } from 'graphql';

import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { getMockOclifConfig } from '../../../__tests__/commands/utils';
import { ObserveQuery } from '../../../graphql/queries/ObserveQuery';
import { buildObserveTraceJson, buildObserveTraceTable } from '../../../observe/formatSpans';
import { EAS_OBSERVE_PLAN_UPGRADE_REQUIRED_ERROR_CODE } from '../../../observe/planGating';
import { enableJsonOutput, printJsonOnlyOutput } from '../../../utils/json';
import ObserveTrace from '../trace';

jest.mock('../../../observe/formatSpans', () => ({
  buildObserveTraceTable: jest.fn().mockReturnValue('trace-table'),
  buildObserveTraceJson: jest.fn().mockReturnValue({ id: 'trace-json' }),
}));
jest.mock('../../../graphql/queries/ObserveQuery', () => ({
  ObserveQuery: {
    traceByIdAsync: jest.fn(),
  },
}));
jest.mock('../../../log');
jest.mock('../../../utils/json');

const mockTraceByIdAsync = jest.mocked(ObserveQuery.traceByIdAsync);
const mockBuildObserveTraceTable = jest.mocked(buildObserveTraceTable);
const mockBuildObserveTraceJson = jest.mocked(buildObserveTraceJson);
const mockEnableJsonOutput = jest.mocked(enableJsonOutput);
const mockPrintJsonOnlyOutput = jest.mocked(printJsonOnlyOutput);

const TRACE_ID = '0123456789abcdef0123456789abcdef';
const trace = { id: TRACE_ID, isTruncated: false, spans: [] } as any;

describe(ObserveTrace, () => {
  const graphqlClient = {} as any as ExpoGraphqlClient;
  const mockConfig = getMockOclifConfig();
  const projectId = 'test-project-id';

  beforeEach(() => {
    jest.clearAllMocks();
    mockTraceByIdAsync.mockResolvedValue(trace);
  });

  function createCommand(argv: string[]): ObserveTrace {
    const command = new ObserveTrace(argv, mockConfig);
    // @ts-expect-error
    jest.spyOn(command, 'getContextAsync').mockReturnValue({
      projectId,
      loggedIn: { graphqlClient },
    });
    return command;
  }

  it('requires a trace ID argument', async () => {
    await expect(createCommand([]).runAsync()).rejects.toThrow();
    expect(mockTraceByIdAsync).not.toHaveBeenCalled();
  });

  it('rejects a malformed trace ID before querying', async () => {
    await expect(createCommand(['not-a-trace-id']).runAsync()).rejects.toThrow(
      /not a valid trace ID/
    );
    expect(mockTraceByIdAsync).not.toHaveBeenCalled();
  });

  it('accepts an uppercase trace ID', async () => {
    await createCommand([TRACE_ID.toUpperCase()]).runAsync();
    expect(mockTraceByIdAsync).toHaveBeenCalledWith(graphqlClient, {
      appId: projectId,
      id: TRACE_ID.toUpperCase(),
    });
  });

  it('renders the trace table by default', async () => {
    await createCommand([TRACE_ID]).runAsync();

    expect(mockTraceByIdAsync).toHaveBeenCalledWith(graphqlClient, {
      appId: projectId,
      id: TRACE_ID,
    });
    expect(mockBuildObserveTraceTable).toHaveBeenCalledWith(trace);
    expect(mockBuildObserveTraceJson).not.toHaveBeenCalled();
  });

  it('emits JSON with --json', async () => {
    await createCommand([TRACE_ID, '--json', '--non-interactive']).runAsync();

    expect(mockEnableJsonOutput).toHaveBeenCalled();
    expect(mockBuildObserveTraceJson).toHaveBeenCalledWith(trace);
    expect(mockPrintJsonOnlyOutput).toHaveBeenCalledWith({ id: 'trace-json' });
    expect(mockBuildObserveTraceTable).not.toHaveBeenCalled();
  });

  it('fails with a not-found message when the trace is unknown', async () => {
    mockTraceByIdAsync.mockResolvedValue(null);
    await expect(createCommand([TRACE_ID]).runAsync()).rejects.toThrow(/No trace found with ID/);
  });

  it('surfaces the plan-gate message', async () => {
    const serverMessage =
      'Access to this feature is not included in your current plan. ' +
      'Upgrade your plan: https://expo.dev/accounts/acme/settings/billing';
    mockTraceByIdAsync.mockRejectedValueOnce(
      new CombinedError({
        graphQLErrors: [
          new GraphQLError(serverMessage, null, null, null, null, null, {
            errorCode: EAS_OBSERVE_PLAN_UPGRADE_REQUIRED_ERROR_CODE,
          }),
        ],
      })
    );
    await expect(createCommand([TRACE_ID]).runAsync()).rejects.toThrow(serverMessage);
  });
});
