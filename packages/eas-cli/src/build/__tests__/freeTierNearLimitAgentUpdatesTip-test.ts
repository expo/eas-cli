import type { ExperimentationDefinition } from '@expo/experimentation';
import { ExpoConfig } from '@expo/config';

import { getAgentTelemetryContext } from '../../analytics/agent';
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
import { Actor } from '../../user/User';
import {
  FREE_TIER_NEAR_LIMIT_AGENT_UPDATES_TIP_EXPERIMENT_NAMESPACE,
  FreeTierNearLimitAgentUpdatesTipExperiment,
  formatFreeTierNearLimitAgentUpdatesTip,
  getFreeTierBuildUsageAsync,
  getFreeTierNearLimitAgentUpdatesTipExperiment,
  getFreeTierNearLimitAgentUpdatesTipPreferenceKey,
  isEligibleForFreeTierNearLimitAgentUpdatesTip,
  isWithinFreeTierNearLimitBand,
  maybeSuggestEASUpdateToAgentNearFreeTierLimitAsync,
  resolveFreeTierNearLimitAgentUpdatesTipVariantAsync,
} from '../freeTierNearLimitAgentUpdatesTip';

jest.mock('../../analytics/agent');
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
const USER = { __typename: 'User', id: 'user-id' } as Actor;
const ROBOT = { __typename: 'Robot', id: 'robot-id' } as Actor;
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

/** Every account is in the experiment: 50% control, 50% treatment. */
const ACCOUNT_DEFINITION: ExperimentationDefinition = {
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
          name: `${EXPERIMENT_NAME} full`,
          experimentName: EXPERIMENT_NAME,
          numSegments: 1000,
        },
      ],
    },
  ],
};

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

/** Probes a throwaway client, so the exposures it logs do not affect the client under test. */
function findAccountIdsByVariant(): Map<string, string> {
  const { client } = createClient();
  return findUnitsByValue(
    accountId =>
      client.getAccountNamespace(FREE_TIER_NEAR_LIMIT_AGENT_UPDATES_TIP_EXPERIMENT_NAMESPACE, {
        accountId,
      }),
    'variant',
    'control',
    ['control', 'treatment']
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

function createExperiment(
  accountId: string,
  {
    client = createClient().client,
    runFromCI = false,
    json = false,
    isRobot = false,
    analytics = createMockAnalytics(),
  }: {
    client?: ExperimentationClient;
    runFromCI?: boolean;
    json?: boolean;
    isRobot?: boolean;
    analytics?: ReturnType<typeof createMockAnalytics>;
  } = {}
): FreeTierNearLimitAgentUpdatesTipExperiment {
  return {
    experimentation: LazyExperimentationClient.fromClient(client),
    graphqlClient: GRAPHQL_CLIENT,
    analytics,
    analyticsEventProperties: ANALYTICS_EVENT_PROPERTIES,
    accountId,
    isRobot,
    projectDir: '/app',
    projectId: 'project-id',
    exp: EXP,
    manifestHostOverride: null,
    runFromCI,
    json,
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

const accountIdsByVariant = findAccountIdsByVariant();
const treatmentAccountId = accountIdsByVariant.get('treatment')!;
const controlAccountId = accountIdsByVariant.get('control')!;

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
  jest.mocked(isExpoUpdatesInstalled).mockReturnValue(false);
  jest.mocked(isUsingEASUpdate).mockReturnValue(false);
  jest.mocked(AccountQuery.getFreeTierBuildUsageAsync).mockResolvedValue(usageResponse());
  logSpy = jest.spyOn(Log, 'log').mockImplementation(() => {});
});

describe(getFreeTierNearLimitAgentUpdatesTipExperiment, () => {
  const ctx = {
    graphqlClient: GRAPHQL_CLIENT,
    analytics: createMockAnalytics(),
    analyticsEventProperties: ANALYTICS_EVENT_PROPERTIES,
    accountId: 'account-id',
    user: USER,
    projectDir: '/app',
    projectId: 'project-id',
    exp: EXP,
    easJsonCliConfig: { updateManifestHostOverride: 'https://u.example.com' },
    runFromCI: false,
  };

  it('returns the handle when the command has an experimentation client', () => {
    const experimentation = new LazyExperimentationClient(async () => createClient().client);

    expect(
      getFreeTierNearLimitAgentUpdatesTipExperiment({ ...ctx, experimentation }, { json: true })
    ).toEqual({
      experimentation,
      graphqlClient: ctx.graphqlClient,
      analytics: ctx.analytics,
      analyticsEventProperties: ANALYTICS_EVENT_PROPERTIES,
      accountId: 'account-id',
      isRobot: false,
      projectDir: '/app',
      projectId: 'project-id',
      exp: EXP,
      manifestHostOverride: 'https://u.example.com',
      runFromCI: false,
      json: true,
    });
  });

  it('marks robot actors', () => {
    const experimentation = new LazyExperimentationClient(async () => createClient().client);

    expect(
      getFreeTierNearLimitAgentUpdatesTipExperiment(
        { ...ctx, user: ROBOT, experimentation },
        { json: false }
      )?.isRobot
    ).toBe(true);
  });

  it('defaults the manifest host override to null', () => {
    const experimentation = new LazyExperimentationClient(async () => createClient().client);

    expect(
      getFreeTierNearLimitAgentUpdatesTipExperiment(
        { ...ctx, easJsonCliConfig: undefined, experimentation },
        { json: false }
      )?.manifestHostOverride
    ).toBeNull();
  });

  it('returns undefined when the command has no experimentation client', () => {
    expect(getFreeTierNearLimitAgentUpdatesTipExperiment(ctx, { json: false })).toBeUndefined();
  });
});

describe(isEligibleForFreeTierNearLimitAgentUpdatesTip, () => {
  it('accepts agent runs for a project without EAS Update', () => {
    expect(isEligibleForFreeTierNearLimitAgentUpdatesTip(createExperiment('account-id'))).toBe(true);
  });

  it('accepts a project with expo-updates installed but no EAS Update URL', () => {
    jest.mocked(isExpoUpdatesInstalled).mockReturnValue(true);

    expect(isEligibleForFreeTierNearLimitAgentUpdatesTip(createExperiment('account-id'))).toBe(true);
  });

  it('rejects a project that is already set up for EAS Update', () => {
    jest.mocked(isExpoUpdatesInstalled).mockReturnValue(true);
    jest.mocked(isUsingEASUpdate).mockReturnValue(true);

    const experiment = createExperiment('account-id');
    expect(isEligibleForFreeTierNearLimitAgentUpdatesTip(experiment)).toBe(false);
    expect(isUsingEASUpdate).toHaveBeenCalledWith(EXP, 'project-id', null);
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

  it('rejects robot actors, which cannot store user preferences', () => {
    expect(
      isEligibleForFreeTierNearLimitAgentUpdatesTip(createExperiment('account-id', { isRobot: true }))
    ).toBe(false);
  });

  it('rejects --json runs', () => {
    expect(
      isEligibleForFreeTierNearLimitAgentUpdatesTip(createExperiment('account-id', { json: true }))
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
        variant: 'treatment',
      }
    );
  });

  it('prints nothing in the control arm but still records the exposure and the marker', async () => {
    const { client, analytics } = createClient();
    const experiment = createExperiment(controlAccountId, { client, analytics });

    await maybeSuggestEASUpdateToAgentNearFreeTierLimitAsync([build(AppPlatform.Android)], experiment);

    expect(logSpy).not.toHaveBeenCalled();
    expect(shownTips).toEqual({
      [getFreeTierNearLimitAgentUpdatesTipPreferenceKey(controlAccountId, AppPlatform.Android)]: {
        billingPeriodId: 'period-1',
      },
    });
    expect(analytics.logEvent).toHaveBeenCalledWith('Experiment Viewed', {
      experimentName: EXPERIMENT_NAME,
      variationName: 'control',
      unit: controlAccountId,
    });
    expect(analytics.logEvent).toHaveBeenCalledWith(
      'build cli free tier near limit agent updates tip',
      expect.objectContaining({ variant: 'control' })
    );
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

  it('fails open when the preference write fails', async () => {
    jest.mocked(UserPreferenceMutation.setAsync).mockRejectedValue(new Error('forbidden'));
    const experiment = treatmentExperiment();

    await expect(
      maybeSuggestEASUpdateToAgentNearFreeTierLimitAsync([build(AppPlatform.Android)], experiment)
    ).resolves.toBeUndefined();

    expect(logSpy).not.toHaveBeenCalled();
    expect(experiment.analytics.logEvent).not.toHaveBeenCalledWith(
      'build cli free tier near limit agent updates tip',
      expect.anything()
    );
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
