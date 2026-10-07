import { getConfig, getConfigFilePaths } from '@expo/config';
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
import { findProjectRootAsync } from '../contextUtils/findProjectDirAndVerifyProjectSetupAsync';

jest.mock('@expo/config');
jest.mock('../../../env', () => ({
  __esModule: true,
  default: { experimentOverride: undefined as string | undefined },
}));
jest.mock('../../../graphql/queries/ExperimentationConfigQuery');
jest.mock('../../../log');
jest.mock('../contextUtils/createGraphqlClient');
jest.mock('../contextUtils/findProjectDirAndVerifyProjectSetupAsync');

const mockEnv = jest.requireMock('../../../env').default as { experimentOverride?: string };
const getConfigsAsyncMock = jest.mocked(ExperimentationConfigQuery.getConfigsAsync);
const getOwnerAccountIdMock = jest.mocked(
  ExperimentationConfigQuery.getOwnerAccountIdForProjectAsync
);
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

beforeEach(() => {
  jest.clearAllMocks();
  mockEnv.experimentOverride = undefined;
  jest.mocked(createGraphqlClient).mockReturnValue(fakeGraphqlClient);
  jest.mocked(findProjectRootAsync).mockResolvedValue('/app');
  jest.mocked(getConfigFilePaths).mockReturnValue({
    staticConfigPath: '/app/app.json',
    dynamicConfigPath: null,
  });
  jest.mocked(getConfig).mockReturnValue({
    exp: { name: 'app', slug: 'app', extra: { eas: { projectId: 'project-1' } } },
  } as any);
  getConfigsAsyncMock.mockResolvedValue(allConfigs);
  getOwnerAccountIdMock.mockResolvedValue('account-1');
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
    client.getAccountNamespace('cli-full').getParam('variant', 'control');
    client.getDeviceNamespace('cli-full').getParam('variant', 'control');

    const units = analytics.logEvent.mock.calls.map(([, properties]) => properties.unit);
    expect(units).toEqual(['user-1', 'account-1', 'device-1']);
    expect(createGraphqlClient).toHaveBeenCalledWith(
      { accessToken: null, sessionSecret: 'secret' },
      { requestTimeoutMs: 3000 }
    );
    expect(getOwnerAccountIdMock).toHaveBeenCalledWith(fakeGraphqlClient, 'project-1');
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

  describe('account resolution', () => {
    it('skips the account lookup outside a project directory', async () => {
      jest
        .mocked(findProjectRootAsync)
        .mockRejectedValue(new Error('Run this command inside a project directory.'));
      const analytics = createAnalytics();
      const client = await new ExperimentationContextField().getValueAsync(options({ analytics }));

      expect(getConfig).not.toHaveBeenCalled();
      expect(getOwnerAccountIdMock).not.toHaveBeenCalled();
      expect(client.getAccountNamespace('cli-full').getParam('variant', 'control')).toBe('control');
      expect(['control', 'treatment']).toContain(
        client.getUserNamespace('cli-full').getParam('variant', 'x')
      );
    });

    it('skips reading the config when the project has no app config file', async () => {
      jest
        .mocked(getConfigFilePaths)
        .mockReturnValue({ staticConfigPath: null, dynamicConfigPath: null });
      const client = await new ExperimentationContextField().getValueAsync(options());

      expect(getConfig).not.toHaveBeenCalled();
      expect(getOwnerAccountIdMock).not.toHaveBeenCalled();
      expect(client.getAccountNamespace('cli-full').getParam('variant', 'control')).toBe('control');
    });

    it('skips the account lookup when the project is not linked', async () => {
      jest.mocked(getConfig).mockReturnValue({ exp: { name: 'app', slug: 'app' } } as any);
      const client = await new ExperimentationContextField().getValueAsync(options());

      expect(getOwnerAccountIdMock).not.toHaveBeenCalled();
      expect(client.getAccountNamespace('cli-full').getParam('variant', 'control')).toBe('control');
    });

    it('reads the config without plugins and without the SDK version requirement', async () => {
      await new ExperimentationContextField().getValueAsync(options());
      expect(getConfig).toHaveBeenCalledWith('/app', {
        skipSDKVersionRequirement: true,
        skipPlugins: true,
      });
    });

    it('uses projectIdOverride without touching the project directory', async () => {
      await new ExperimentationContextField().getValueAsync(
        options({ projectIdOverride: 'override-1' })
      );

      expect(findProjectRootAsync).not.toHaveBeenCalled();
      expect(getConfig).not.toHaveBeenCalled();
      expect(getOwnerAccountIdMock).toHaveBeenCalledWith(fakeGraphqlClient, 'override-1');
    });

    it('keeps user and device experiments when the account lookup fails', async () => {
      getOwnerAccountIdMock.mockRejectedValue(new Error('Not authorized'));
      const analytics = createAnalytics();
      const client = await new ExperimentationContextField().getValueAsync(options({ analytics }));

      expect(client.getAccountNamespace('cli-full').getParam('variant', 'control')).toBe('control');
      expect(['control', 'treatment']).toContain(
        client.getUserNamespace('cli-full').getParam('variant', 'x')
      );
      expect(Log.debug).toHaveBeenCalledWith(
        expect.stringContaining('owner account'),
        expect.anything()
      );
    });

    it('lets a command pass an explicit account ID', async () => {
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
  });

  it('runs the config fetch and the account lookup in parallel', async () => {
    let resolveConfigs!: (value: typeof allConfigs) => void;
    let resolveOwner!: (value: string) => void;
    getConfigsAsyncMock.mockReturnValue(new Promise(resolve => (resolveConfigs = resolve)));
    getOwnerAccountIdMock.mockReturnValue(new Promise(resolve => (resolveOwner = resolve)));

    const pending = new ExperimentationContextField().getValueAsync(options());
    await flushPromisesAsync();

    expect(getConfigsAsyncMock).toHaveBeenCalledTimes(1);
    expect(getOwnerAccountIdMock).toHaveBeenCalledTimes(1);

    resolveConfigs(allConfigs);
    resolveOwner('account-1');
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
