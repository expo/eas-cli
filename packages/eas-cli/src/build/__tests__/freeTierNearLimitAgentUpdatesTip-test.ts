import type { ExperimentationDefinition } from '@expo/experimentation';
import { ExpoConfig } from '@expo/config';

import { getAgentTelemetryContext } from '../../analytics/agent';
import { createGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { ExperimentOverrides } from '../../experimentation/ExperimentOverrides';
import {
  EMPTY_EXPERIMENTATION_DEFINITION,
  ExperimentationClient,
  createLoggerConfig,
} from '../../experimentation/ExperimentationClient';
import { LazyExperimentationClient } from '../../experimentation/LazyExperimentationClient';
import { createMockAnalytics, findUnitsByValue } from '../../experimentation/__tests__/fixtures';
import {
  AppPlatform,
  BuildFragment,
  BuildStatus,
  EasServiceMetric,
  UsageMetricType,
} from '../../graphql/generated';
import { UserPreferenceMutation } from '../../graphql/mutations/UserPreferenceMutation';
import { AccountQuery } from '../../graphql/queries/AccountQuery';
import { UserPreferenceQuery } from '../../graphql/queries/UserPreferenceQuery';
import Log from '../../log';
import { isExpoUpdatesInstalled, isUsingEASUpdate } from '../../project/projectUtils';
import { LoggedInAuthenticationInfo } from '../../user/SessionManager';
import { Actor } from '../../user/User';
import {
  FREE_TIER_NEAR_LIMIT_AGENT_UPDATES_TIP_EXPERIMENT_NAMESPACE,
  FreeTierNearLimitAgentUpdatesTipExperiment,
  FreeTierNearLimitAgentUpdatesTipPlatformProject,
  formatFreeTierNearLimitAgentUpdatesTip,
  getFreeTierBuildUsageAsync,
  getFreeTierNearLimitAgentUpdatesTipExperiment,
  getFreeTierNearLimitAgentUpdatesTipPreferenceKey,
  isEligibleForFreeTierNearLimitAgentUpdatesTip,
  isPlatformEligibleForFreeTierNearLimitAgentUpdatesTip,
  isWithinFreeTierNearLimitBand,
  maybeSuggestEASUpdateToAgentNearFreeTierLimitAsync,
  resolveFreeTierNearLimitAgentUpdatesTipVariantAsync,
} from '../freeTierNearLimitAgentUpdatesTip';

jest.mock('../../analytics/agent');
jest.mock('../../commandUtils/context/contextUtils/createGraphqlClient');
jest.mock('../../graphql/queries/AccountQuery');
jest.mock('../../graphql/queries/UserPreferenceQuery');
jest.mock('../../graphql/mutations/UserPreferenceMutation');
jest.mock('../../project/projectUtils', () => ({
  ...jest.requireActual('../../project/projectUtils'),
  isExpoUpdatesInstalled: jest.fn(),
  isUsingEASUpdate: jest.fn(),
}));

const EXPERIMENT_NAME = 'cli-build-free-tier-near-limit-agent-updates-tip';
const ANALYTICS_EVENT_PROPERTIES = { tracking_id: 'tracking-id' };
const EXP = { name: 'app', slug: 'app' } as ExpoConfig;
const IOS_EXP = { name: 'app', slug: 'app', ios: { bundleIdentifier: 'com.app' } } as ExpoConfig;
const USER = { __typename: 'User', id: 'user-id' } as Actor;
const SSO_USER = { __typename: 'SSOUser', id: 'sso-user-id' } as Actor;
const ROBOT = { __typename: 'Robot', id: 'robot-id' } as Actor;
const PARTNER = { __typename: 'PartnerActor', id: 'partner-id' } as Actor;
const AUTHENTICATION_INFO: LoggedInAuthenticationInfo = {
  accessToken: 'access-token',
  sessionSecret: null,
};
const GRAPHQL_CLIENT = {} as FreeTierNearLimitAgentUpdatesTipExperiment['graphqlClient'];

const ANDROID_KEY = 'free-tier-near-limit-agent-updates-tip-shown/account-id/android';
const IOS_KEY = 'free-tier-near-limit-agent-updates-tip-shown/account-id/ios';

const ANDROID_TIP_11_OF_15 = [
  "Tip: this account has used 11 of 15 Android builds on the Free plan this period. This project isn't set up for EAS Update, so every change needs a new build.",
  'With EAS Update, JavaScript, styling and image changes reach installed builds without a new build. Setup takes effect from the next build, so it saves the most builds if done now.',
  'Next: eas update:configure --non-interactive, then build once more.',
  'Tell the user: this adds expo-updates and changes app.json and eas.json.',
  'Docs: https://docs.expo.dev/eas-update/getting-started/',
].join('\n');

function accountDefinition(enrolledSegments: number): ExperimentationDefinition {
  return {
    experiments: [
      {
        experimentName: EXPERIMENT_NAME,
        paramDefinitions: {
          variant: { type: 'uniform_choice', choices: ['control', 'treatment'] },
        },
        exposureLoggerType: 'rudderstack',
      },
    ],
    namespaces: [
      {
        name: FREE_TIER_NEAR_LIMIT_AGENT_UPDATES_TIP_EXPERIMENT_NAMESPACE,
        numSegments: 1000,
        segmentExperimentSetupDefinitions: [
          {
            method: 'ADD',
            name: `${EXPERIMENT_NAME} rollout`,
            experimentName: EXPERIMENT_NAME,
            numSegments: enrolledSegments,
          },
        ],
      },
    ],
  };
}

/** Every account is in the experiment: 50% control, 50% treatment. */
const ACCOUNT_DEFINITION = accountDefinition(1000);

/** Like the production soft launch: 20% of accounts are in the experiment. */
const PARTIAL_ROLLOUT_DEFINITION = accountDefinition(200);

function createClient(definition: ExperimentationDefinition = ACCOUNT_DEFINITION): {
  client: ExperimentationClient;
  analytics: ReturnType<typeof createMockAnalytics>;
} {
  const analytics = createMockAnalytics();
  const client = new ExperimentationClient(
    {
      user: EMPTY_EXPERIMENTATION_DEFINITION,
      account: definition,
      device: EMPTY_EXPERIMENTATION_DEFINITION,
    },
    { user: null, device: null },
    ExperimentOverrides.empty(),
    createLoggerConfig(analytics)
  );
  return { client, analytics };
}

/**
 * Probes a throwaway client, so the exposures it logs do not affect the client under test. The
 * probe uses a null default, so accounts outside the rollout can be told apart from control.
 */
function findAccountIdsByVariant(
  definition: ExperimentationDefinition,
  variants: (string | null)[]
): Map<string | null, string> {
  const { client } = createClient(definition);
  return findUnitsByValue(
    accountId =>
      client.getAccountNamespace(FREE_TIER_NEAR_LIMIT_AGENT_UPDATES_TIP_EXPERIMENT_NAMESPACE, {
        accountId,
      }),
    'variant',
    null,
    variants
  );
}

function createOverriddenClient(variant: string): ExperimentationClient {
  return ExperimentationClient.createDisabled(
    new ExperimentOverrides(
      new Map([
        [FREE_TIER_NEAR_LIMIT_AGENT_UPDATES_TIP_EXPERIMENT_NAMESPACE, new Map([['variant', variant]])],
      ])
    )
  );
}

function project(
  overrides: Partial<FreeTierNearLimitAgentUpdatesTipPlatformProject> = {}
): FreeTierNearLimitAgentUpdatesTipPlatformProject {
  return {
    developmentClient: false,
    projectDir: '/app',
    projectId: 'project-id',
    exp: EXP,
    manifestHostOverride: null,
    ...overrides,
  };
}

function createExperiment(
  accountId: string,
  {
    client = createClient().client,
    runFromCI = false,
    json = false,
    isUser = true,
    analytics = createMockAnalytics(),
    projectByPlatform = { [AppPlatform.Android]: project(), [AppPlatform.Ios]: project() },
  }: {
    client?: ExperimentationClient;
    runFromCI?: boolean;
    json?: boolean;
    isUser?: boolean;
    analytics?: ReturnType<typeof createMockAnalytics>;
    projectByPlatform?: FreeTierNearLimitAgentUpdatesTipExperiment['projectByPlatform'];
  } = {}
): FreeTierNearLimitAgentUpdatesTipExperiment {
  return {
    experimentation: LazyExperimentationClient.fromClient(client),
    graphqlClient: GRAPHQL_CLIENT,
    analytics,
    analyticsEventProperties: ANALYTICS_EVENT_PROPERTIES,
    accountId,
    isUser,
    runFromCI,
    json,
    projectByPlatform,
  };
}

function build(platform: AppPlatform, status: BuildStatus = BuildStatus.Finished): BuildFragment {
  return { id: `${platform}-build`, platform, status } as BuildFragment;
}

type PlatformUsage = { value: number; limit: number };

function usageResponse({
  subscriptionName = 'Free' as string | null,
  android = { value: 11, limit: 15 } as PlatformUsage,
  ios = { value: 3, limit: 15 } as PlatformUsage,
  billingPeriodId = 'period-1',
  platformBreakdown = true,
} = {}): Awaited<ReturnType<typeof AccountQuery.getFreeTierBuildUsageAsync>> {
  return {
    id: 'account-id',
    subscription: subscriptionName === null ? null : { id: 'subscription-id', name: subscriptionName },
    billingPeriod: {
      id: billingPeriodId,
      start: '2026-10-01T00:00:00.000Z',
      end: '2026-11-01T00:00:00.000Z',
    },
    usageMetrics: {
      EAS_BUILD: {
        id: 'eas-build',
        planMetrics: [
          {
            id: 'builds',
            serviceMetric: EasServiceMetric.Builds,
            metricType: UsageMetricType.Build,
            value: android.value + ios.value,
            limit: android.limit + ios.limit,
            platformBreakdown: platformBreakdown ? { android, ios } : null,
          },
        ],
      },
    },
  };
}

const accountIdsByVariant = findAccountIdsByVariant(ACCOUNT_DEFINITION, ['control', 'treatment']);
const treatmentAccountId = accountIdsByVariant.get('treatment')!;
const controlAccountId = accountIdsByVariant.get('control')!;
/** An account outside the partial rollout. */
const notEnrolledAccountId = findAccountIdsByVariant(PARTIAL_ROLLOUT_DEFINITION, [null]).get(null)!;

/** In-memory stand-in for the server-side user preference store, keyed by preference key. */
let shownTips: Record<string, unknown>;
let logSpy: jest.SpyInstance;

beforeEach(() => {
  jest.resetAllMocks();
  shownTips = {};
  jest
    .mocked(UserPreferenceQuery.getValueAsync)
    .mockImplementation(async (_graphqlClient, key) => shownTips[key] ?? null);
  jest
    .mocked(UserPreferenceMutation.setAsync)
    .mockImplementation(async (_graphqlClient, key, value) => {
      shownTips[key] = value;
    });
  jest.mocked(getAgentTelemetryContext).mockReturnValue({ id: 'claude-code', sessionId: 's-1' });
  jest.mocked(createGraphqlClient).mockReturnValue(GRAPHQL_CLIENT);
  jest.mocked(isExpoUpdatesInstalled).mockReturnValue(false);
  jest.mocked(isUsingEASUpdate).mockReturnValue(false);
  jest.mocked(AccountQuery.getFreeTierBuildUsageAsync).mockResolvedValue(usageResponse());
  logSpy = jest.spyOn(Log, 'log').mockImplementation(() => {});
});

describe(getFreeTierNearLimitAgentUpdatesTipExperiment, () => {
  const ctx = {
    authenticationInfo: AUTHENTICATION_INFO,
    analytics: createMockAnalytics(),
    analyticsEventProperties: ANALYTICS_EVENT_PROPERTIES,
    accountId: 'account-id',
    user: USER,
    developmentClient: false,
    projectDir: '/app',
    projectId: 'project-id',
    exp: EXP,
    easJsonCliConfig: { updateManifestHostOverride: 'https://u.example.com' },
    runFromCI: false,
  };

  it('returns the handle when the command has an experimentation client', () => {
    const experimentation = new LazyExperimentationClient(async () => createClient().client);

    expect(
      getFreeTierNearLimitAgentUpdatesTipExperiment(
        { [AppPlatform.Android]: { ...ctx, experimentation } },
        { json: true }
      )
    ).toEqual({
      experimentation,
      graphqlClient: GRAPHQL_CLIENT,
      analytics: ctx.analytics,
      analyticsEventProperties: ANALYTICS_EVENT_PROPERTIES,
      accountId: 'account-id',
      isUser: true,
      runFromCI: false,
      json: true,
      projectByPlatform: {
        [AppPlatform.Android]: {
          developmentClient: false,
          projectDir: '/app',
          projectId: 'project-id',
          exp: EXP,
          manifestHostOverride: 'https://u.example.com',
        },
      },
    });
  });

  it('keeps the project state of each platform', () => {
    const experimentation = new LazyExperimentationClient(async () => createClient().client);

    expect(
      getFreeTierNearLimitAgentUpdatesTipExperiment(
        {
          [AppPlatform.Android]: { ...ctx, experimentation },
          [AppPlatform.Ios]: {
            ...ctx,
            experimentation,
            exp: IOS_EXP,
            developmentClient: true,
            easJsonCliConfig: undefined,
          },
        },
        { json: false }
      )?.projectByPlatform
    ).toEqual({
      [AppPlatform.Android]: project({ manifestHostOverride: 'https://u.example.com' }),
      [AppPlatform.Ios]: project({ exp: IOS_EXP, developmentClient: true }),
    });
  });

  it('creates one GraphQL client with a request timeout', () => {
    const experimentation = new LazyExperimentationClient(async () => createClient().client);

    getFreeTierNearLimitAgentUpdatesTipExperiment(
      {
        [AppPlatform.Android]: { ...ctx, experimentation },
        [AppPlatform.Ios]: { ...ctx, experimentation },
      },
      { json: false }
    );

    expect(createGraphqlClient).toHaveBeenCalledTimes(1);
    expect(createGraphqlClient).toHaveBeenCalledWith(AUTHENTICATION_INFO, {
      requestTimeoutMs: 3000,
    });
  });

  it.each([
    ['a regular user', USER, true],
    ['an SSO user', SSO_USER, true],
    ['a robot', ROBOT, false],
    ['a partner actor', PARTNER, false],
  ])('marks %s with isUser %p', (_label, user, isUser) => {
    const experimentation = new LazyExperimentationClient(async () => createClient().client);

    expect(
      getFreeTierNearLimitAgentUpdatesTipExperiment(
        { [AppPlatform.Android]: { ...ctx, user, experimentation } },
        { json: false }
      )?.isUser
    ).toBe(isUser);
  });

  it('returns undefined when the command has no experimentation client', () => {
    expect(
      getFreeTierNearLimitAgentUpdatesTipExperiment({ [AppPlatform.Android]: ctx }, { json: false })
    ).toBeUndefined();
  });

  it('returns undefined when the command has no authentication info', () => {
    const experimentation = new LazyExperimentationClient(async () => createClient().client);

    expect(
      getFreeTierNearLimitAgentUpdatesTipExperiment(
        { [AppPlatform.Android]: { ...ctx, authenticationInfo: undefined, experimentation } },
        { json: false }
      )
    ).toBeUndefined();
    expect(createGraphqlClient).not.toHaveBeenCalled();
  });

  it('returns undefined without build contexts', () => {
    expect(getFreeTierNearLimitAgentUpdatesTipExperiment({}, { json: false })).toBeUndefined();
  });
});

describe(isEligibleForFreeTierNearLimitAgentUpdatesTip, () => {
  it('accepts agent runs', () => {
    expect(isEligibleForFreeTierNearLimitAgentUpdatesTip(createExperiment('account-id'))).toBe(true);
  });

  it('rejects runs without a coding agent', () => {
    jest.mocked(getAgentTelemetryContext).mockReturnValue(null);

    expect(isEligibleForFreeTierNearLimitAgentUpdatesTip(createExperiment('account-id'))).toBe(false);
  });

  it('rejects runs from CI', () => {
    expect(
      isEligibleForFreeTierNearLimitAgentUpdatesTip(createExperiment('account-id', { runFromCI: true }))
    ).toBe(false);
  });

  it('rejects robot and partner actors, which cannot store user preferences', () => {
    expect(
      isEligibleForFreeTierNearLimitAgentUpdatesTip(createExperiment('account-id', { isUser: false }))
    ).toBe(false);
  });

  it('rejects --json runs', () => {
    expect(
      isEligibleForFreeTierNearLimitAgentUpdatesTip(createExperiment('account-id', { json: true }))
    ).toBe(false);
  });
});

describe(isPlatformEligibleForFreeTierNearLimitAgentUpdatesTip, () => {
  it('accepts a project without EAS Update', () => {
    expect(isPlatformEligibleForFreeTierNearLimitAgentUpdatesTip(project())).toBe(true);
  });

  it('accepts a project with expo-updates installed but no EAS Update URL', () => {
    jest.mocked(isExpoUpdatesInstalled).mockReturnValue(true);

    expect(isPlatformEligibleForFreeTierNearLimitAgentUpdatesTip(project())).toBe(true);
  });

  it('rejects a project that is already set up for EAS Update', () => {
    jest.mocked(isExpoUpdatesInstalled).mockReturnValue(true);
    jest.mocked(isUsingEASUpdate).mockReturnValue(true);

    expect(isPlatformEligibleForFreeTierNearLimitAgentUpdatesTip(project())).toBe(false);
    expect(isUsingEASUpdate).toHaveBeenCalledWith(EXP, 'project-id', null);
  });

  it('rejects development builds, which load JavaScript from the dev server', () => {
    expect(
      isPlatformEligibleForFreeTierNearLimitAgentUpdatesTip(project({ developmentClient: true }))
    ).toBe(false);
  });
});

describe(isWithinFreeTierNearLimitBand, () => {
  it.each([
    [9, false],
    [10, true],
    [11, true],
    [14, true],
    [15, false],
    [16, false],
  ])('used %s of 15 → %s', (used, expected) => {
    expect(isWithinFreeTierNearLimitBand({ used, limit: 15 })).toBe(expected);
  });

  it('is false without a limit', () => {
    expect(isWithinFreeTierNearLimitBand({ used: 0, limit: 0 })).toBe(false);
  });
});

describe(getFreeTierBuildUsageAsync, () => {
  it('returns the per-platform usage for a Free account', async () => {
    expect(await getFreeTierBuildUsageAsync(createExperiment('account-id'))).toEqual({
      billingPeriodId: 'period-1',
      byPlatform: {
        [AppPlatform.Android]: { used: 11, limit: 15 },
        [AppPlatform.Ios]: { used: 3, limit: 15 },
      },
    });
    expect(AccountQuery.getFreeTierBuildUsageAsync).toHaveBeenCalledWith(
      expect.anything(),
      'account-id',
      expect.any(Date)
    );
  });

  it('treats an account without a subscription as Free', async () => {
    jest
      .mocked(AccountQuery.getFreeTierBuildUsageAsync)
      .mockResolvedValue(usageResponse({ subscriptionName: null }));

    expect(await getFreeTierBuildUsageAsync(createExperiment('account-id'))).not.toBeNull();
  });

  it('returns null for a paid plan', async () => {
    jest
      .mocked(AccountQuery.getFreeTierBuildUsageAsync)
      .mockResolvedValue(usageResponse({ subscriptionName: 'Starter' }));

    expect(await getFreeTierBuildUsageAsync(createExperiment('account-id'))).toBeNull();
  });

  it('returns null without a platform breakdown', async () => {
    jest
      .mocked(AccountQuery.getFreeTierBuildUsageAsync)
      .mockResolvedValue(usageResponse({ platformBreakdown: false }));

    expect(await getFreeTierBuildUsageAsync(createExperiment('account-id'))).toBeNull();
  });
});

describe(resolveFreeTierNearLimitAgentUpdatesTipVariantAsync, () => {
  it('returns the account variant and logs the exposure once', async () => {
    const { client, analytics } = createClient();
    const experiment = createExperiment(treatmentAccountId, { client });

    expect(await resolveFreeTierNearLimitAgentUpdatesTipVariantAsync(experiment)).toBe('treatment');
    expect(await resolveFreeTierNearLimitAgentUpdatesTipVariantAsync(experiment)).toBe('treatment');

    expect(analytics.logEvent).toHaveBeenCalledTimes(1);
    expect(analytics.logEvent).toHaveBeenCalledWith('Experiment Viewed', {
      experimentName: EXPERIMENT_NAME,
      variationName: 'treatment',
      unit: treatmentAccountId,
    });
  });

  it('logs the exposure for control accounts too', async () => {
    const { client, analytics } = createClient();

    expect(
      await resolveFreeTierNearLimitAgentUpdatesTipVariantAsync(
        createExperiment(controlAccountId, { client })
      )
    ).toBe('control');
    expect(analytics.logEvent).toHaveBeenCalledWith('Experiment Viewed', {
      experimentName: EXPERIMENT_NAME,
      variationName: 'control',
      unit: controlAccountId,
    });
  });

  it('returns control and logs no exposure for an account outside the rollout', async () => {
    const { client, analytics } = createClient(PARTIAL_ROLLOUT_DEFINITION);

    expect(
      await resolveFreeTierNearLimitAgentUpdatesTipVariantAsync(
        createExperiment(notEnrolledAccountId, { client })
      )
    ).toBe('control');
    expect(analytics.logEvent).not.toHaveBeenCalled();
  });

  it('returns control and logs no exposure when the namespace is missing from the config', async () => {
    const { client, analytics } = createClient(EMPTY_EXPERIMENTATION_DEFINITION);

    expect(
      await resolveFreeTierNearLimitAgentUpdatesTipVariantAsync(
        createExperiment(treatmentAccountId, { client })
      )
    ).toBe('control');
    expect(analytics.logEvent).not.toHaveBeenCalled();
  });
});

describe(getFreeTierNearLimitAgentUpdatesTipPreferenceKey, () => {
  it('scopes the key to the account and the lowercase platform', () => {
    expect(getFreeTierNearLimitAgentUpdatesTipPreferenceKey('account-id', AppPlatform.Android)).toBe(
      ANDROID_KEY
    );
    expect(getFreeTierNearLimitAgentUpdatesTipPreferenceKey('account-id', AppPlatform.Ios)).toBe(
      IOS_KEY
    );
  });
});

describe(formatFreeTierNearLimitAgentUpdatesTip, () => {
  it('formats the Android tip', () => {
    expect(
      formatFreeTierNearLimitAgentUpdatesTip({ platform: AppPlatform.Android, used: 11, limit: 15 })
    ).toBe(ANDROID_TIP_11_OF_15);
  });

  it('formats the iOS tip', () => {
    expect(
      formatFreeTierNearLimitAgentUpdatesTip({ platform: AppPlatform.Ios, used: 14, limit: 15 })
    ).toContain('Tip: this account has used 14 of 15 iOS builds on the Free plan this period.');
  });
});

describe(maybeSuggestEASUpdateToAgentNearFreeTierLimitAsync, () => {
  function treatmentExperiment(
    options: Parameters<typeof createExperiment>[1] = {}
  ): FreeTierNearLimitAgentUpdatesTipExperiment {
    return createExperiment('account-id', {
      client: createOverriddenClient('treatment'),
      ...options,
    });
  }

  it('does nothing when the command has no experiment handle', async () => {
    await maybeSuggestEASUpdateToAgentNearFreeTierLimitAsync([build(AppPlatform.Android)], undefined);

    expect(AccountQuery.getFreeTierBuildUsageAsync).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('requests no usage for ineligible runs', async () => {
    jest.mocked(getAgentTelemetryContext).mockReturnValue(null);

    await maybeSuggestEASUpdateToAgentNearFreeTierLimitAsync(
      [build(AppPlatform.Android)],
      treatmentExperiment()
    );

    expect(AccountQuery.getFreeTierBuildUsageAsync).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('requests no usage when no build finished', async () => {
    await maybeSuggestEASUpdateToAgentNearFreeTierLimitAsync(
      [build(AppPlatform.Android, BuildStatus.Errored), null],
      treatmentExperiment()
    );

    expect(AccountQuery.getFreeTierBuildUsageAsync).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('requests no usage when no finished platform is eligible', async () => {
    await maybeSuggestEASUpdateToAgentNearFreeTierLimitAsync(
      [build(AppPlatform.Android)],
      treatmentExperiment({
        projectByPlatform: { [AppPlatform.Android]: project({ developmentClient: true }) },
      })
    );

    expect(AccountQuery.getFreeTierBuildUsageAsync).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('checks each platform against its own build context', async () => {
    // Only the iOS build evaluated a config with the EAS Update URL.
    jest.mocked(isExpoUpdatesInstalled).mockReturnValue(true);
    jest.mocked(isUsingEASUpdate).mockImplementation(exp => exp === IOS_EXP);
    jest
      .mocked(AccountQuery.getFreeTierBuildUsageAsync)
      .mockResolvedValue(usageResponse({ ios: { value: 14, limit: 15 } }));

    await maybeSuggestEASUpdateToAgentNearFreeTierLimitAsync(
      [build(AppPlatform.Android), build(AppPlatform.Ios)],
      treatmentExperiment({
        projectByPlatform: {
          [AppPlatform.Android]: project(),
          [AppPlatform.Ios]: project({ exp: IOS_EXP }),
        },
      })
    );

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(ANDROID_TIP_11_OF_15);
    expect(shownTips).toEqual({ [ANDROID_KEY]: { billingPeriodId: 'period-1' } });
  });

  it('prints the tip in the treatment arm and remembers it for the billing period', async () => {
    const experiment = treatmentExperiment();

    await maybeSuggestEASUpdateToAgentNearFreeTierLimitAsync([build(AppPlatform.Android)], experiment);

    expect(logSpy).toHaveBeenCalledWith(ANDROID_TIP_11_OF_15);
    expect(shownTips).toEqual({ [ANDROID_KEY]: { billingPeriodId: 'period-1' } });
    expect(UserPreferenceMutation.setAsync).toHaveBeenCalledWith(GRAPHQL_CLIENT, ANDROID_KEY, {
      billingPeriodId: 'period-1',
    });
    expect(experiment.analytics.logEvent).toHaveBeenCalledWith(
      'build cli free tier near limit agent updates tip',
      {
        ...ANALYTICS_EVENT_PROPERTIES,
        platform: AppPlatform.Android,
        builds_used: 11,
        builds_limit: 15,
      }
    );
  });

  it('prints nothing and writes no marker in the control arm, but records the exposure', async () => {
    const { client, analytics } = createClient();
    const experiment = createExperiment(controlAccountId, { client, analytics });

    await maybeSuggestEASUpdateToAgentNearFreeTierLimitAsync([build(AppPlatform.Android)], experiment);

    expect(logSpy).not.toHaveBeenCalled();
    expect(shownTips).toEqual({});
    expect(UserPreferenceMutation.setAsync).not.toHaveBeenCalled();
    expect(analytics.logEvent).toHaveBeenCalledWith('Experiment Viewed', {
      experimentName: EXPERIMENT_NAME,
      variationName: 'control',
      unit: controlAccountId,
    });
    expect(analytics.logEvent).not.toHaveBeenCalledWith(
      'build cli free tier near limit agent updates tip',
      expect.anything()
    );
  });

  it('does nothing for an account outside the experiment', async () => {
    const { client, analytics } = createClient(PARTIAL_ROLLOUT_DEFINITION);
    const experiment = createExperiment(notEnrolledAccountId, { client, analytics });

    await maybeSuggestEASUpdateToAgentNearFreeTierLimitAsync([build(AppPlatform.Android)], experiment);

    expect(logSpy).not.toHaveBeenCalled();
    expect(analytics.logEvent).not.toHaveBeenCalled();
    expect(shownTips).toEqual({});
    expect(UserPreferenceMutation.setAsync).not.toHaveBeenCalled();
  });

  it('logs the exposure only after the usage checks pass', async () => {
    const { client, analytics } = createClient();
    jest
      .mocked(AccountQuery.getFreeTierBuildUsageAsync)
      .mockResolvedValue(usageResponse({ android: { value: 9, limit: 15 } }));

    await maybeSuggestEASUpdateToAgentNearFreeTierLimitAsync(
      [build(AppPlatform.Android)],
      createExperiment(treatmentAccountId, { client, analytics })
    );

    expect(analytics.logEvent).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
    expect(UserPreferenceQuery.getValueAsync).not.toHaveBeenCalled();
    expect(UserPreferenceMutation.setAsync).not.toHaveBeenCalled();
  });

  it('does nothing for paid plans', async () => {
    jest
      .mocked(AccountQuery.getFreeTierBuildUsageAsync)
      .mockResolvedValue(usageResponse({ subscriptionName: 'Production' }));
    const experiment = treatmentExperiment();

    await maybeSuggestEASUpdateToAgentNearFreeTierLimitAsync([build(AppPlatform.Android)], experiment);

    expect(logSpy).not.toHaveBeenCalled();
    expect(experiment.analytics.logEvent).not.toHaveBeenCalled();
  });

  it('does not repeat the tip within the same billing period for this user', async () => {
    shownTips = { [ANDROID_KEY]: { billingPeriodId: 'period-1' } };
    const experiment = treatmentExperiment();

    await maybeSuggestEASUpdateToAgentNearFreeTierLimitAsync([build(AppPlatform.Android)], experiment);

    expect(UserPreferenceQuery.getValueAsync).toHaveBeenCalledWith(GRAPHQL_CLIENT, ANDROID_KEY);
    expect(logSpy).not.toHaveBeenCalled();
    expect(experiment.analytics.logEvent).not.toHaveBeenCalled();
    expect(UserPreferenceMutation.setAsync).not.toHaveBeenCalled();
  });

  it('shows the tip again in a new billing period', async () => {
    const otherAccountIosKey = 'free-tier-near-limit-agent-updates-tip-shown/other-account/ios';
    shownTips = {
      [ANDROID_KEY]: { billingPeriodId: 'period-0' },
      [otherAccountIosKey]: { billingPeriodId: 'period-1' },
    };

    await maybeSuggestEASUpdateToAgentNearFreeTierLimitAsync(
      [build(AppPlatform.Android)],
      treatmentExperiment()
    );

    expect(logSpy).toHaveBeenCalledWith(ANDROID_TIP_11_OF_15);
    expect(shownTips).toEqual({
      [ANDROID_KEY]: { billingPeriodId: 'period-1' },
      [otherAccountIosKey]: { billingPeriodId: 'period-1' },
    });
  });

  it('treats a malformed stored preference as not shown', async () => {
    shownTips = { [ANDROID_KEY]: 'period-1' };

    await maybeSuggestEASUpdateToAgentNearFreeTierLimitAsync(
      [build(AppPlatform.Android)],
      treatmentExperiment()
    );

    expect(logSpy).toHaveBeenCalledWith(ANDROID_TIP_11_OF_15);
    expect(shownTips).toEqual({ [ANDROID_KEY]: { billingPeriodId: 'period-1' } });
  });

  it('checks each finished platform with one usage request', async () => {
    jest
      .mocked(AccountQuery.getFreeTierBuildUsageAsync)
      .mockResolvedValue(usageResponse({ ios: { value: 14, limit: 15 } }));

    await maybeSuggestEASUpdateToAgentNearFreeTierLimitAsync(
      [build(AppPlatform.Android), build(AppPlatform.Ios)],
      treatmentExperiment()
    );

    expect(AccountQuery.getFreeTierBuildUsageAsync).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledTimes(2);
    expect(logSpy).toHaveBeenCalledWith(ANDROID_TIP_11_OF_15);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('used 14 of 15 iOS builds on the Free plan')
    );
    expect(shownTips).toEqual({
      [ANDROID_KEY]: { billingPeriodId: 'period-1' },
      [IOS_KEY]: { billingPeriodId: 'period-1' },
    });
  });

  it('skips platforms outside the band', async () => {
    await maybeSuggestEASUpdateToAgentNearFreeTierLimitAsync(
      [build(AppPlatform.Android), build(AppPlatform.Ios)],
      treatmentExperiment()
    );

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(ANDROID_TIP_11_OF_15);
    expect(shownTips).toEqual({ [ANDROID_KEY]: { billingPeriodId: 'period-1' } });
  });

  it('still shows the tip and logs the events when the marker write fails', async () => {
    jest.mocked(UserPreferenceMutation.setAsync).mockRejectedValue(new Error('forbidden'));
    const { client, analytics } = createClient();
    const experiment = createExperiment(treatmentAccountId, { client, analytics });

    await expect(
      maybeSuggestEASUpdateToAgentNearFreeTierLimitAsync([build(AppPlatform.Android)], experiment)
    ).resolves.toBeUndefined();

    expect(logSpy).toHaveBeenCalledWith(ANDROID_TIP_11_OF_15);
    expect(analytics.logEvent).toHaveBeenCalledWith('Experiment Viewed', {
      experimentName: EXPERIMENT_NAME,
      variationName: 'treatment',
      unit: treatmentAccountId,
    });
    expect(analytics.logEvent).toHaveBeenCalledWith(
      'build cli free tier near limit agent updates tip',
      expect.objectContaining({ platform: AppPlatform.Android })
    );
    expect(shownTips).toEqual({});
  });

  it('still checks the next platform when a marker write fails', async () => {
    jest
      .mocked(UserPreferenceMutation.setAsync)
      .mockRejectedValueOnce(new Error('forbidden'))
      .mockImplementation(async (_graphqlClient, key, value) => {
        shownTips[key] = value;
      });
    jest
      .mocked(AccountQuery.getFreeTierBuildUsageAsync)
      .mockResolvedValue(usageResponse({ ios: { value: 14, limit: 15 } }));

    await maybeSuggestEASUpdateToAgentNearFreeTierLimitAsync(
      [build(AppPlatform.Android), build(AppPlatform.Ios)],
      treatmentExperiment()
    );

    expect(logSpy).toHaveBeenCalledTimes(2);
    expect(logSpy).toHaveBeenCalledWith(ANDROID_TIP_11_OF_15);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('used 14 of 15 iOS builds on the Free plan')
    );
    expect(shownTips).toEqual({ [IOS_KEY]: { billingPeriodId: 'period-1' } });
  });

  it('fails open when the usage request fails', async () => {
    jest
      .mocked(AccountQuery.getFreeTierBuildUsageAsync)
      .mockRejectedValue(new Error('network down'));
    const experiment = treatmentExperiment();

    await expect(
      maybeSuggestEASUpdateToAgentNearFreeTierLimitAsync([build(AppPlatform.Android)], experiment)
    ).resolves.toBeUndefined();

    expect(logSpy).not.toHaveBeenCalled();
    expect(experiment.analytics.logEvent).not.toHaveBeenCalled();
  });
});
