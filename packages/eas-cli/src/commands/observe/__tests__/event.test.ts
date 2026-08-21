import { CombinedError } from '@urql/core';
import { GraphQLError } from 'graphql';

import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { getMockOclifConfig } from '../../../__tests__/commands/utils';
import { ObserveQuery } from '../../../graphql/queries/ObserveQuery';
import {
  buildObserveCustomEventDetail,
  buildObserveCustomEventJson,
} from '../../../observe/formatCustomEvents';
import { buildObserveEventDetail, buildObserveEventJson } from '../../../observe/formatEvents';
import { EAS_OBSERVE_FEATURE_NOT_AVAILABLE_IN_FREE_TIER_ERROR_CODE } from '../../../observe/planGating';
import { enableJsonOutput, printJsonOnlyOutput } from '../../../utils/json';
import ObserveEvent from '../event';

jest.mock('../../../observe/formatEvents', () => ({
  buildObserveEventDetail: jest.fn().mockReturnValue('metric-detail'),
  buildObserveEventJson: jest.fn().mockReturnValue({ id: 'metric-json' }),
}));
jest.mock('../../../observe/formatCustomEvents', () => ({
  buildObserveCustomEventDetail: jest.fn().mockReturnValue('log-detail'),
  buildObserveCustomEventJson: jest.fn().mockReturnValue({ id: 'log-json' }),
}));
jest.mock('../../../graphql/queries/ObserveQuery', () => ({
  ObserveQuery: {
    eventByIdAsync: jest.fn(),
  },
}));
jest.mock('../../../log');
jest.mock('../../../utils/json');

const mockEventByIdAsync = jest.mocked(ObserveQuery.eventByIdAsync);
const mockBuildObserveEventDetail = jest.mocked(buildObserveEventDetail);
const mockBuildObserveEventJson = jest.mocked(buildObserveEventJson);
const mockBuildObserveCustomEventDetail = jest.mocked(buildObserveCustomEventDetail);
const mockBuildObserveCustomEventJson = jest.mocked(buildObserveCustomEventJson);
const mockEnableJsonOutput = jest.mocked(enableJsonOutput);
const mockPrintJsonOnlyOutput = jest.mocked(printJsonOnlyOutput);

describe(ObserveEvent, () => {
  const graphqlClient = {} as any as ExpoGraphqlClient;
  const mockConfig = getMockOclifConfig();
  const projectId = 'test-project-id';

  beforeEach(() => {
    jest.clearAllMocks();
    mockEventByIdAsync.mockResolvedValue({ event: null, customEvent: null });
  });

  function createCommand(argv: string[]): ObserveEvent {
    const command = new ObserveEvent(argv, mockConfig);
    // @ts-expect-error
    jest.spyOn(command, 'getContextAsync').mockReturnValue({
      projectId,
      loggedIn: { graphqlClient },
    });
    return command;
  }

  function planGateError(): CombinedError {
    const serverMessage =
      'Subscription to EAS is required for this feature. ' +
      'Subscribe: https://expo.dev/accounts/acme/settings/billing';
    return new CombinedError({
      graphQLErrors: [
        new GraphQLError(serverMessage, null, null, null, null, null, {
          errorCode: EAS_OBSERVE_FEATURE_NOT_AVAILABLE_IN_FREE_TIER_ERROR_CODE,
        }),
      ],
    });
  }

  it('looks up the event by the provided id', async () => {
    mockEventByIdAsync.mockResolvedValue({ event: { id: 'evt' } as any, customEvent: null });
    await createCommand(['evt']).runAsync();
    expect(mockEventByIdAsync).toHaveBeenCalledWith(graphqlClient, { appId: projectId, id: 'evt' });
  });

  it('renders a metric event when only a metric event resolves', async () => {
    mockEventByIdAsync.mockResolvedValue({ event: { id: 'metric-1' } as any, customEvent: null });
    await createCommand(['metric-1']).runAsync();
    expect(mockBuildObserveEventDetail).toHaveBeenCalledTimes(1);
    expect(mockBuildObserveCustomEventDetail).not.toHaveBeenCalled();
  });

  it('renders a log event when only a custom event resolves', async () => {
    mockEventByIdAsync.mockResolvedValue({ event: null, customEvent: { id: 'log-1' } as any });
    await createCommand(['log-1']).runAsync();
    expect(mockBuildObserveCustomEventDetail).toHaveBeenCalledTimes(1);
    expect(mockBuildObserveEventDetail).not.toHaveBeenCalled();
  });

  it('prefers the custom event when both resolve', async () => {
    mockEventByIdAsync.mockResolvedValue({
      event: { id: 'x' } as any,
      customEvent: { id: 'x' } as any,
    });
    await createCommand(['x']).runAsync();
    expect(mockBuildObserveCustomEventDetail).toHaveBeenCalledTimes(1);
    expect(mockBuildObserveEventDetail).not.toHaveBeenCalled();
  });

  it('emits typed JSON for a metric event with --json', async () => {
    mockEventByIdAsync.mockResolvedValue({ event: { id: 'metric-1' } as any, customEvent: null });
    await createCommand(['metric-1', '--json', '--non-interactive']).runAsync();
    expect(mockEnableJsonOutput).toHaveBeenCalledTimes(1);
    expect(mockBuildObserveEventJson).toHaveBeenCalledTimes(1);
    expect(mockPrintJsonOnlyOutput).toHaveBeenCalledWith({
      type: 'metric',
      event: { id: 'metric-json' },
    });
  });

  it('emits typed JSON for a log event with --json', async () => {
    mockEventByIdAsync.mockResolvedValue({ event: null, customEvent: { id: 'log-1' } as any });
    await createCommand(['log-1', '--json', '--non-interactive']).runAsync();
    expect(mockBuildObserveCustomEventJson).toHaveBeenCalledTimes(1);
    expect(mockPrintJsonOnlyOutput).toHaveBeenCalledWith({
      type: 'log',
      event: { id: 'log-json' },
    });
  });

  it('throws when no event resolves for the id', async () => {
    mockEventByIdAsync.mockResolvedValue({ event: null, customEvent: null });
    await expect(createCommand(['missing']).runAsync()).rejects.toThrow(
      /No Observe event found with ID "missing"/
    );
  });

  it('surfaces the plan-gate message when the lookup is not available on the plan', async () => {
    mockEventByIdAsync.mockRejectedValueOnce(planGateError());
    await expect(createCommand(['evt']).runAsync()).rejects.toThrow(
      /Subscription to EAS is required/
    );
  });
});
