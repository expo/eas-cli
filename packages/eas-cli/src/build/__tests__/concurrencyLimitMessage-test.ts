import type { ExperimentationDefinition } from '@expo/experimentation';

import { BuildEvent } from '../../analytics/AnalyticsManager';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { ExperimentOverrides } from '../../experimentation/ExperimentOverrides';
import {
  EMPTY_EXPERIMENTATION_DEFINITION,
  ExperimentationClient,
  createLoggerConfig,
} from '../../experimentation/ExperimentationClient';
import { createMockAnalytics, findUnitsByValue } from '../../experimentation/__tests__/fixtures';
import { AccountConcurrencyUsage, AccountQuery } from '../../graphql/queries/AccountQuery';
import Log from '../../log';
import {
  CONCURRENCY_LIMIT_EXPERIMENT_NAMESPACE,
  ConcurrencyLimitMessage,
  ConcurrencyLimitMessageOptions,
  formatConcurrencyLimitMessage,
} from '../concurrencyLimitMessage';

jest.mock('../../graphql/queries/AccountQuery');
jest.mock('../../log', () => ({
  __esModule: true,
  ...jest.requireActual('../../log'),
  link: jest.fn((url: string, opts?: { text?: string }) => opts?.text ?? url),
}));

const graphqlClient = {} as unknown as ExpoGraphqlClient;

function createClientWithVariant(variant: string): ExperimentationClient {
  return ExperimentationClient.createDisabled(
    new ExperimentOverrides(
      new Map([[CONCURRENCY_LIMIT_EXPERIMENT_NAMESPACE, new Map([['variant', variant]])]])
    )
  );
}

function createUsage({
  planId = 'price_starter',
  planName = 'Starter',
  total = 2 as number | null,
  activeCount = 2,
  jobRunCount = 0,
}: {
  planId?: string;
  planName?: string;
  total?: number | null;
  activeCount?: number;
  jobRunCount?: number;
} = {}): AccountConcurrencyUsage {
  return {
    __typename: 'Account',
    id: 'account-id',
    subscription: {
      __typename: 'SubscriptionDetails',
      id: 'subscription-id',
      name: planName,
      planId,
      concurrencies:
        total === null
          ? null
          : { __typename: 'Concurrencies', total, android: total, ios: total },
    },
    concurrencyConsumers: [
      ...Array.from({ length: activeCount }, (_, i) => ({
        __typename: 'Build' as const,
        id: `build-${i}`,
      })),
      ...Array.from({ length: jobRunCount }, (_, i) => ({
        __typename: 'JobRun' as const,
        id: `job-run-${i}`,
      })),
    ],
  };
}

function createMessage(overrides: Partial<ConcurrencyLimitMessageOptions> = {}): {
  message: ConcurrencyLimitMessage;
  analytics: ReturnType<typeof createMockAnalytics>;
} {
  const analytics = createMockAnalytics();
  const message = new ConcurrencyLimitMessage({
    graphqlClient,
    experimentation: createClientWithVariant('treatment'),
    analytics,
    accountId: 'account-id',
    accountName: 'acme',
    buildIds: ['build-id'],
    nonInteractive: false,
    analyticsEventProperties: { tracking_id: 'tracking-id', platform: 'android' },
    ...overrides,
  });
  return { message, analytics };
}

function loggedMessage(): string {
  return jest.mocked(Log.log).mock.calls.map(call => call.join(' ')).join('\n');
}

describe(ConcurrencyLimitMessage, () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Log, 'log').mockImplementation(() => {});
    jest.spyOn(Log, 'newLine').mockImplementation(() => {});
    jest.spyOn(Log, 'debug').mockImplementation(() => {});
    jest.mocked(AccountQuery.getConcurrencyUsageAsync).mockResolvedValue(createUsage());
  });

  it('is not built when the command has no experimentation client', () => {
    expect(
      ConcurrencyLimitMessage.forBuildRun({
        experimentation: undefined,
        graphqlClient,
        analytics: createMockAnalytics(),
        startedBuilds: [{ build: { id: 'build-id' } }],
        nonInteractive: false,
        buildCtx: {
          accountId: 'account-id',
          accountName: 'acme',
          analyticsEventProperties: {},
        },
      })
    ).toBeUndefined();
  });

  it('takes the account and event properties from the build context', async () => {
    const analytics = createMockAnalytics();
    const message = ConcurrencyLimitMessage.forBuildRun({
      experimentation: createClientWithVariant('treatment'),
      graphqlClient,
      analytics,
      startedBuilds: [{ build: { id: 'build-a' } }, { build: { id: 'build-b' } }],
      nonInteractive: true,
      buildCtx: {
        accountId: 'ctx-account-id',
        accountName: 'ctx-account',
        analyticsEventProperties: { tracking_id: 'ctx-tracking-id' },
      },
    });

    await expect(message?.maybeShowAsync()).resolves.toBe(true);

    expect(AccountQuery.getConcurrencyUsageAsync).toHaveBeenCalledWith(
      graphqlClient,
      'ctx-account-id'
    );
    expect(loggedMessage()).toContain('/accounts/ctx-account/settings/billing');
    expect(analytics.logEvent).toHaveBeenCalledWith(
      BuildEvent.CONCURRENCY_LIMIT_MESSAGE_SHOWN,
      expect.objectContaining({
        tracking_id: 'ctx-tracking-id',
        build_ids: 'build-a,build-b',
        build_count: 2,
        non_interactive: true,
      })
    );
  });

  it('does nothing for the control variant', async () => {
    const { message, analytics } = createMessage({
      experimentation: createClientWithVariant('control'),
    });

    await expect(message.maybeShowAsync()).resolves.toBe(false);

    expect(AccountQuery.getConcurrencyUsageAsync).not.toHaveBeenCalled();
    expect(Log.log).not.toHaveBeenCalled();
    expect(analytics.logEvent).not.toHaveBeenCalled();
  });

  it('does nothing when the namespace is unknown', async () => {
    const { message, analytics } = createMessage({
      experimentation: ExperimentationClient.createDisabled(ExperimentOverrides.empty()),
    });

    await expect(message.maybeShowAsync()).resolves.toBe(false);

    expect(AccountQuery.getConcurrencyUsageAsync).not.toHaveBeenCalled();
    expect(analytics.logEvent).not.toHaveBeenCalled();
  });

  it('prints the paid-plan message once and logs the event', async () => {
    const { message, analytics } = createMessage();

    await expect(message.maybeShowAsync()).resolves.toBe(true);

    expect(AccountQuery.getConcurrencyUsageAsync).toHaveBeenCalledTimes(1);
    expect(AccountQuery.getConcurrencyUsageAsync).toHaveBeenCalledWith(graphqlClient, 'account-id');
    expect(Log.log).toHaveBeenCalledTimes(1);
    const text = loggedMessage();
    expect(text).toContain('2 builds are already running and the Starter plan includes 2.');
    expect(text).toContain('Add concurrencies ($50/mo each)');
    expect(text).toContain(
      'https://expo.dev/accounts/acme/settings/billing?utm_source=eas-cli&utm_campaign=cli-build-concurrency-limit'
    );
    expect(text).not.toContain('billing:subscribe');
    expect(analytics.logEvent).toHaveBeenCalledTimes(1);
    expect(analytics.logEvent).toHaveBeenCalledWith(
      BuildEvent.CONCURRENCY_LIMIT_MESSAGE_SHOWN,
      expect.objectContaining({
        tracking_id: 'tracking-id',
        platform: 'android',
        experiment_name: CONCURRENCY_LIMIT_EXPERIMENT_NAMESPACE,
        variant: 'treatment',
        build_ids: 'build-id',
        build_count: 1,
        active_consumer_count: 2,
        active_build_count: 2,
        active_job_run_count: 0,
        concurrency_limit: 2,
        has_paid_plan: true,
        plan_id: 'price_starter',
        plan_name: 'Starter',
        non_interactive: false,
      })
    );
  });

  it('prints the upgrade path for a free plan', async () => {
    jest
      .mocked(AccountQuery.getConcurrencyUsageAsync)
      .mockResolvedValue(createUsage({ planId: 'price_free', planName: 'Free', total: 1, activeCount: 1 }));
    const { message, analytics } = createMessage({ nonInteractive: true });

    await expect(message.maybeShowAsync()).resolves.toBe(true);

    const text = loggedMessage();
    expect(text).toContain('1 build is already running and the Free plan includes 1.');
    expect(text).toContain('Upgrade to Starter or Production');
    expect(text).toContain(
      'https://expo.dev/accounts/acme/settings/billing?utm_source=eas-cli&utm_campaign=cli-build-concurrency-limit'
    );
    expect(text).toContain('eas billing:subscribe starter --account acme');
    expect(text).not.toContain('$50/mo');
    expect(analytics.logEvent).toHaveBeenCalledWith(
      BuildEvent.CONCURRENCY_LIMIT_MESSAGE_SHOWN,
      expect.objectContaining({ has_paid_plan: false, non_interactive: true })
    );
  });

  it('names workflow jobs that hold a concurrency', async () => {
    jest
      .mocked(AccountQuery.getConcurrencyUsageAsync)
      .mockResolvedValue(createUsage({ total: 3, activeCount: 1, jobRunCount: 2 }));
    const { message, analytics } = createMessage();

    await expect(message.maybeShowAsync()).resolves.toBe(true);

    expect(loggedMessage()).toContain(
      '1 build and 2 workflow jobs are already running and the Starter plan includes 3.'
    );
    expect(analytics.logEvent).toHaveBeenCalledWith(
      BuildEvent.CONCURRENCY_LIMIT_MESSAGE_SHOWN,
      expect.objectContaining({
        active_consumer_count: 3,
        active_build_count: 1,
        active_job_run_count: 2,
      })
    );
  });

  it('shows the upgrade path and omits plan fields when the account has no subscription', async () => {
    jest
      .mocked(AccountQuery.getConcurrencyUsageAsync)
      .mockResolvedValue({ ...createUsage({ activeCount: 1 }), subscription: null });
    const { message, analytics } = createMessage();

    await expect(message.maybeShowAsync()).resolves.toBe(true);

    const text = loggedMessage();
    expect(text).toContain('All concurrencies in your plan are in use.');
    expect(text).toContain('Upgrade to Starter or Production');
    expect(analytics.logEvent).toHaveBeenCalledTimes(1);
    const [, properties] = jest.mocked(analytics.logEvent).mock.calls[0];
    expect(properties).toEqual(
      expect.objectContaining({
        active_consumer_count: 1,
        concurrency_limit: -1,
        has_paid_plan: false,
      })
    );
    expect(properties).not.toHaveProperty('plan_id');
    expect(properties).not.toHaveProperty('plan_name');
  });

  it('uses the count-free copy when the plan concurrencies are unknown', async () => {
    jest.mocked(AccountQuery.getConcurrencyUsageAsync).mockResolvedValue(createUsage({ total: null }));
    const { message, analytics } = createMessage();

    await expect(message.maybeShowAsync()).resolves.toBe(true);

    expect(loggedMessage()).toContain('All concurrencies in your plan are in use.');
    expect(analytics.logEvent).toHaveBeenCalledWith(
      BuildEvent.CONCURRENCY_LIMIT_MESSAGE_SHOWN,
      expect.objectContaining({ concurrency_limit: -1 })
    );
  });

  it('uses the count-free copy when the totals do not confirm the limit', async () => {
    jest
      .mocked(AccountQuery.getConcurrencyUsageAsync)
      .mockResolvedValue(createUsage({ total: 4, activeCount: 2 }));
    const { message } = createMessage();

    await expect(message.maybeShowAsync()).resolves.toBe(true);

    const text = loggedMessage();
    expect(text).toContain('All concurrencies in your plan are in use.');
    expect(text).not.toContain('already running');
  });

  it('falls back silently when the account query fails', async () => {
    jest
      .mocked(AccountQuery.getConcurrencyUsageAsync)
      .mockRejectedValue(new Error('network down'));
    const { message, analytics } = createMessage();

    await expect(message.maybeShowAsync()).resolves.toBe(false);

    expect(Log.debug).toHaveBeenCalledTimes(1);
    expect(Log.log).not.toHaveBeenCalled();
    expect(analytics.logEvent).not.toHaveBeenCalled();
  });

  it('runs the query, the print, and the event only once across repeated calls', async () => {
    const { message, analytics } = createMessage();

    await expect(
      Promise.all([message.maybeShowAsync(), message.maybeShowAsync(), message.maybeShowAsync()])
    ).resolves.toEqual([true, true, true]);
    await expect(message.maybeShowAsync()).resolves.toBe(true);

    expect(AccountQuery.getConcurrencyUsageAsync).toHaveBeenCalledTimes(1);
    expect(Log.log).toHaveBeenCalledTimes(1);
    expect(analytics.logEvent).toHaveBeenCalledTimes(1);
  });

  it('logs the exposure on the first call, not on construction', async () => {
    const definition: ExperimentationDefinition = {
      experiments: [
        {
          experimentName: CONCURRENCY_LIMIT_EXPERIMENT_NAMESPACE,
          paramDefinitions: {
            variant: { type: 'uniform_choice', choices: ['control', 'treatment'] },
          },
          exposureLoggerType: 'rudderstack',
        },
      ],
      namespaces: [
        {
          name: CONCURRENCY_LIMIT_EXPERIMENT_NAMESPACE,
          numSegments: 1000,
          segmentExperimentSetupDefinitions: [
            {
              method: 'ADD',
              name: 'full rollout',
              experimentName: CONCURRENCY_LIMIT_EXPERIMENT_NAMESPACE,
              numSegments: 1000,
            },
          ],
        },
      ],
    };
    const createClient = (
      analytics: ReturnType<typeof createMockAnalytics>
    ): ExperimentationClient =>
      new ExperimentationClient(
        {
          user: EMPTY_EXPERIMENTATION_DEFINITION,
          account: definition,
          device: EMPTY_EXPERIMENTATION_DEFINITION,
        },
        { user: null, device: null },
        ExperimentOverrides.empty(),
        createLoggerConfig(analytics)
      );
    const probeClient = createClient(createMockAnalytics());
    const units = findUnitsByValue(
      accountId =>
        probeClient.getAccountNamespace(CONCURRENCY_LIMIT_EXPERIMENT_NAMESPACE, { accountId }),
      'variant',
      'control',
      ['control', 'treatment']
    );

    const analytics = createMockAnalytics();
    const { message } = createMessage({
      analytics,
      experimentation: createClient(analytics),
      accountId: units.get('treatment'),
    });
    expect(analytics.logEvent).not.toHaveBeenCalled();

    await expect(message.maybeShowAsync()).resolves.toBe(true);
    await expect(message.maybeShowAsync()).resolves.toBe(true);

    const eventNames = analytics.logEvent.mock.calls.map(([name]) => name);
    expect(eventNames.filter(name => name === 'Experiment Viewed')).toHaveLength(1);
    expect(analytics.logEvent).toHaveBeenCalledWith('Experiment Viewed', {
      experimentName: CONCURRENCY_LIMIT_EXPERIMENT_NAMESPACE,
      variationName: 'treatment',
      unit: units.get('treatment'),
    });
  });
});

describe(formatConcurrencyLimitMessage, () => {
  it('names the current plan when the plan name is unknown', () => {
    const text = formatConcurrencyLimitMessage({
      accountName: 'acme',
      planName: null,
      activeBuildCount: 3,
      activeJobRunCount: 0,
      concurrencyLimit: 3,
      hasPaidPlan: true,
    });
    expect(text).toContain('3 builds are already running and the current plan includes 3.');
  });

  it('uses the singular form for one workflow job', () => {
    const text = formatConcurrencyLimitMessage({
      accountName: 'acme',
      planName: 'Free',
      activeBuildCount: 0,
      activeJobRunCount: 1,
      concurrencyLimit: 1,
      hasPaidPlan: false,
    });
    expect(text).toContain('1 workflow job is already running and the Free plan includes 1.');
  });
});
