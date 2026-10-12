import { instance, mock, verify, when } from 'ts-mockito';

import { AnalyticsWithOrchestration } from '../../../analytics/AnalyticsManager';
import { TEST_DEFINITION } from '../../../experimentation/__tests__/fixtures';
import { ExperimentationConfigQuery } from '../../../graphql/queries/ExperimentationConfigQuery';
import Log from '../../../log';
import SessionManager from '../../../user/SessionManager';
import { Actor } from '../../../user/User';
import { ContextOptions } from '../ContextField';
import ExperimentationContextField from '../ExperimentationContextField';
import { createGraphqlClient } from '../contextUtils/createGraphqlClient';

jest.mock('../../../env', () => ({
  __esModule: true,
  default: { experimentOverride: undefined as string | undefined },
}));
jest.mock('../../../graphql/queries/ExperimentationConfigQuery');
jest.mock('../../../log');
jest.mock('../contextUtils/createGraphqlClient');

const mockEnv = jest.requireMock('../../../env').default as { experimentOverride?: string };
const getConfigsAsyncMock = jest.mocked(ExperimentationConfigQuery.getConfigsAsync);
const fakeGraphqlClient = { fake: true } as any;

const actor = { __typename: 'User', id: 'user-1' } as unknown as Actor;
const emptyDefinition = { experiments: [], namespaces: [] };
const allConfigs = {
  userConfig: TEST_DEFINITION,
  accountConfig: TEST_DEFINITION,
  deviceConfig: TEST_DEFINITION,
};

function createAnalytics(deviceId: string | null = 'device-1'): AnalyticsWithOrchestration & {
  logEvent: jest.Mock;
} {
  return {
    logEvent: jest.fn(),
    setActor: jest.fn(),
    flushAsync: jest.fn(),
    getDeviceId: jest.fn(() => deviceId),
  };
}

function createSessionManager({ loggedOut = false }: { loggedOut?: boolean } = {}): {
  sessionManager: SessionManager;
  mocked: SessionManager;
} {
  const mocked = mock<SessionManager>();
  when(mocked.getAccessToken()).thenReturn(null);
  when(mocked.getSessionSecret()).thenReturn(loggedOut ? null : 'secret');
  when(mocked.getUserAsync()).thenResolve(loggedOut ? undefined : actor);
  return { sessionManager: instance(mocked), mocked };
}

function options(overrides: Partial<ContextOptions> = {}): ContextOptions {
  return {
    nonInteractive: false,
    sessionManager: createSessionManager().sessionManager,
    analytics: createAnalytics(),
    ...overrides,
  } as ContextOptions;
}

async function flushPromisesAsync(): Promise<void> {
  await new Promise(resolve => setImmediate(resolve));
}

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

const ORIGINAL_ENV = process.env;

beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
  delete process.env.CI;
  delete process.env.EAS_BUILD;
  mockEnv.experimentOverride = undefined;
  jest.mocked(createGraphqlClient).mockReturnValue(fakeGraphqlClient);
  getConfigsAsyncMock.mockResolvedValue(allConfigs);
});

describe(ExperimentationContextField, () => {
  it('returns a disabled client and fetches nothing when analytics is disabled', async () => {
    const { sessionManager, mocked } = createSessionManager();
    const client = await new ExperimentationContextField().getValueAsync(
      options({ analytics: createAnalytics(null), sessionManager })
    );

    expect(client.getUserNamespace('cli-full').getParam('variant', 'control')).toBe('control');
    expect(client.getDeviceNamespace('cli-full').getParam('variant', 'control')).toBe('control');
    expect(getConfigsAsyncMock).not.toHaveBeenCalled();
    expect(createGraphqlClient).not.toHaveBeenCalled();
    verify(mocked.getUserAsync()).never();
  });

  it.each(['CI', 'EAS_BUILD'])(
    'returns a disabled client and fetches nothing when %s is set',
    async flag => {
      process.env[flag] = '1';
      const { sessionManager, mocked } = createSessionManager();
      const client = await new ExperimentationContextField().getValueAsync(
        options({ sessionManager })
      );

      expect(client.getUserNamespace('cli-full').getParam('variant', 'control')).toBe('control');
      expect(client.getDeviceNamespace('cli-full').getParam('variant', 'control')).toBe('control');
      expect(getConfigsAsyncMock).not.toHaveBeenCalled();
      expect(createGraphqlClient).not.toHaveBeenCalled();
      verify(mocked.getUserAsync()).never();
    }
  );

  it('still honors EAS_EXPERIMENT_OVERRIDE in CI', async () => {
    process.env.CI = 'true';
    mockEnv.experimentOverride = 'cli-full:variant=treatment';
    const client = await new ExperimentationContextField().getValueAsync(options());
    expect(client.getUserNamespace('cli-full').getParam('variant', 'control')).toBe('treatment');
    expect(getConfigsAsyncMock).not.toHaveBeenCalled();
  });

  it('still honors EAS_EXPERIMENT_OVERRIDE when analytics is disabled', async () => {
    mockEnv.experimentOverride = 'cli-full:variant=treatment';
    const client = await new ExperimentationContextField().getValueAsync(
      options({ analytics: createAnalytics(null) })
    );
    expect(client.getUserNamespace('cli-full').getParam('variant', 'control')).toBe('treatment');
  });

  it('buckets each scope on its own unit and logs exposures through analytics', async () => {
    const analytics = createAnalytics('device-1');
    const client = await new ExperimentationContextField().getValueAsync(options({ analytics }));

    client.getUserNamespace('cli-full').getParam('variant', 'control');
    client
      .getAccountNamespace('cli-full', { accountId: 'account-1' })
      .getParam('variant', 'control');
    client.getDeviceNamespace('cli-full').getParam('variant', 'control');

    const units = analytics.logEvent.mock.calls.map(([, properties]) => properties.unit);
    expect(units).toEqual(['user-1', 'account-1', 'device-1']);
    expect(createGraphqlClient).toHaveBeenCalledWith(
      { accessToken: null, sessionSecret: 'secret' },
      { requestTimeoutMs: 3000 }
    );
  });

  it('gives logged-out users defaults for user experiments but still runs device experiments', async () => {
    const analytics = createAnalytics('device-1');
    const { sessionManager } = createSessionManager({ loggedOut: true });
    const client = await new ExperimentationContextField().getValueAsync(
      options({ analytics, sessionManager })
    );

    expect(client.getUserNamespace('cli-full').getParam('variant', 'control')).toBe('control');
    expect(['control', 'treatment']).toContain(
      client.getDeviceNamespace('cli-full').getParam('variant', 'x')
    );
    expect(analytics.logEvent).toHaveBeenCalledTimes(1);
  });

  it('fails open to defaults when the config fetch rejects', async () => {
    getConfigsAsyncMock.mockRejectedValue(new Error('offline'));
    const analytics = createAnalytics();
    const client = await new ExperimentationContextField().getValueAsync(options({ analytics }));

    expect(client.getUserNamespace('cli-full').getParam('variant', 'control')).toBe('control');
    expect(client.getDeviceNamespace('cli-full').getParam('variant', 'control')).toBe('control');
    expect(analytics.logEvent).not.toHaveBeenCalled();
    expect(Log.debug).toHaveBeenCalledWith(
      expect.stringContaining('Failed to fetch'),
      expect.anything()
    );
    expect(Log.error).not.toHaveBeenCalled();
    expect(Log.warn).not.toHaveBeenCalled();
  });

  it('returns defaults and logs nothing for empty configs, as the server sends for robots', async () => {
    getConfigsAsyncMock.mockResolvedValue({
      userConfig: emptyDefinition,
      accountConfig: emptyDefinition,
      deviceConfig: emptyDefinition,
    });
    const analytics = createAnalytics();
    const client = await new ExperimentationContextField().getValueAsync(options({ analytics }));

    expect(client.getUserNamespace('cli-full').getParam('variant', 'control')).toBe('control');
    expect(analytics.logEvent).not.toHaveBeenCalled();
  });

  it('fails open to defaults when the server config is invalid', async () => {
    getConfigsAsyncMock.mockResolvedValue({
      ...allConfigs,
      userConfig: {
        experiments: TEST_DEFINITION.experiments,
        namespaces: [
          {
            name: 'too-many',
            numSegments: 10,
            segmentExperimentSetupDefinitions: [
              { method: 'ADD', name: 'all', experimentName: 'cli-test', numSegments: 20 },
            ],
          },
        ],
      },
    });
    const client = await new ExperimentationContextField().getValueAsync(options());

    expect(client.getDeviceNamespace('cli-full').getParam('variant', 'control')).toBe('control');
    expect(Log.debug).toHaveBeenCalledWith(
      expect.stringContaining('Failed to initialize'),
      expect.anything()
    );
  });

  it('logs account exposures on the account ID the command passes', async () => {
    const analytics = createAnalytics();
    const client = await new ExperimentationContextField().getValueAsync(options({ analytics }));
    client
      .getAccountNamespace('cli-full', { accountId: 'picked-account' })
      .getParam('variant', 'x');
    expect(analytics.logEvent).toHaveBeenCalledWith(
      'Experiment Viewed',
      expect.objectContaining({ unit: 'picked-account' })
    );
  });

  it('runs the actor lookup and the config fetch in parallel', async () => {
    let resolveConfigs!: (value: typeof allConfigs) => void;
    let resolveActor!: (value: Actor) => void;
    getConfigsAsyncMock.mockReturnValue(new Promise(resolve => (resolveConfigs = resolve)));
    const mocked = mock<SessionManager>();
    when(mocked.getAccessToken()).thenReturn(null);
    when(mocked.getSessionSecret()).thenReturn('secret');
    when(mocked.getUserAsync()).thenReturn(new Promise(resolve => (resolveActor = resolve)));

    const pending = new ExperimentationContextField().getValueAsync(
      options({ sessionManager: instance(mocked) })
    );
    await flushPromisesAsync();

    expect(getConfigsAsyncMock).toHaveBeenCalledTimes(1);
    verify(mocked.getUserAsync()).once();

    resolveConfigs(allConfigs);
    resolveActor(actor);
    await expect(pending).resolves.toBeDefined();
  });

  it('caches one client per analytics instance so repeated context calls do not log duplicate exposures', async () => {
    const field = new ExperimentationContextField();
    const analytics = createAnalytics();
    const first = await field.getValueAsync(options({ analytics }));
    const second = await field.getValueAsync(options({ analytics }));
    const other = await field.getValueAsync(options({ analytics: createAnalytics() }));

    expect(second).toBe(first);
    expect(other).not.toBe(first);
    expect(getConfigsAsyncMock).toHaveBeenCalledTimes(2);
  });
});
