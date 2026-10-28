import { ExpoConfig } from '@expo/config';

import { getAgentTelemetryContext } from '../analytics/agent';
import { Analytics, AnalyticsEventProperties, BuildEvent } from '../analytics/AnalyticsManager';
import {
  ExpoGraphqlClient,
  createGraphqlClient,
} from '../commandUtils/context/contextUtils/createGraphqlClient';
import { LazyExperimentationClient } from '../experimentation/LazyExperimentationClient';
import {
  AppPlatform,
  BuildFragment,
  BuildStatus,
  EasServiceMetric,
  UsageMetricType,
} from '../graphql/generated';
import { UserPreferenceMutation } from '../graphql/mutations/UserPreferenceMutation';
import { AccountQuery } from '../graphql/queries/AccountQuery';
import { UserPreferenceQuery } from '../graphql/queries/UserPreferenceQuery';
import Log from '../log';
import { appPlatformDisplayNames } from '../platform';
import { isExpoUpdatesInstalled, isUsingEASUpdate } from '../project/projectUtils';
import { LoggedInAuthenticationInfo } from '../user/SessionManager';
import { Actor } from '../user/User';

export const FREE_TIER_NEAR_LIMIT_AGENT_UPDATES_TIP_EXPERIMENT_NAMESPACE =
  'cli-build-free-tier-near-limit-agent-updates-tip';

/** The tip shows when this many builds or fewer are left on the platform. */
export const FREE_TIER_NEAR_LIMIT_AGENT_UPDATES_TIP_BUILDS_LEFT = 5;

export const EAS_UPDATE_GETTING_STARTED_URL = 'https://docs.expo.dev/eas-update/getting-started/';

/** Server-side user preference key prefix. The full key is `<prefix>/<accountId>/<platform>`. */
const USER_PREFERENCE_KEY_PREFIX = 'free-tier-near-limit-agent-updates-tip-shown';

/** The tip's requests run after the build, so a stalled request must not delay the exit. */
const REQUEST_TIMEOUT_MS = 3000;

export type FreeTierNearLimitAgentUpdatesTipVariant = 'control' | 'treatment';

/** The project state of one platform's build. Each build profile evaluates its own config. */
export type FreeTierNearLimitAgentUpdatesTipPlatformProject = {
  developmentClient: boolean;
  projectDir: string;
  projectId: string;
  exp: ExpoConfig;
  manifestHostOverride: string | null;
};

export type FreeTierNearLimitAgentUpdatesTipExperiment = {
  experimentation: LazyExperimentationClient;
  graphqlClient: ExpoGraphqlClient;
  analytics: Analytics;
  analyticsEventProperties: AnalyticsEventProperties;
  accountId: string;
  /** Only regular and SSO users can store user preferences. */
  isUser: boolean;
  runFromCI: boolean;
  json: boolean;
  projectByPlatform: Partial<Record<AppPlatform, FreeTierNearLimitAgentUpdatesTipPlatformProject>>;
};

export type FreeTierNearLimitAgentUpdatesTipBuildContext = {
  experimentation?: LazyExperimentationClient;
  authenticationInfo?: LoggedInAuthenticationInfo;
  analytics: Analytics;
  analyticsEventProperties: AnalyticsEventProperties;
  accountId: string;
  user: Actor;
  developmentClient: boolean;
  projectDir: string;
  projectId: string;
  exp: ExpoConfig;
  easJsonCliConfig: { updateManifestHostOverride?: string } | undefined;
  runFromCI: boolean;
};

export type FreeTierPlatformBuildUsage = {
  used: number;
  limit: number;
};

export type FreeTierBuildUsage = {
  billingPeriodId: string;
  byPlatform: Record<AppPlatform, FreeTierPlatformBuildUsage>;
};

/** All build contexts belong to one command run, so the account and the actor are shared. */
export function getFreeTierNearLimitAgentUpdatesTipExperiment(
  buildCtxByPlatform: Partial<Record<AppPlatform, FreeTierNearLimitAgentUpdatesTipBuildContext>>,
  { json }: { json: boolean }
): FreeTierNearLimitAgentUpdatesTipExperiment | undefined {
  const ctx = Object.values(buildCtxByPlatform)[0];
  if (!ctx?.experimentation || !ctx.authenticationInfo) {
    return undefined;
  }
  const projectByPlatform: FreeTierNearLimitAgentUpdatesTipExperiment['projectByPlatform'] = {};
  for (const [platform, platformCtx] of Object.entries(buildCtxByPlatform)) {
    projectByPlatform[platform as AppPlatform] = {
      developmentClient: platformCtx.developmentClient,
      projectDir: platformCtx.projectDir,
      projectId: platformCtx.projectId,
      exp: platformCtx.exp,
      manifestHostOverride: platformCtx.easJsonCliConfig?.updateManifestHostOverride ?? null,
    };
  }
  return {
    experimentation: ctx.experimentation,
    graphqlClient: createGraphqlClient(ctx.authenticationInfo, {
      requestTimeoutMs: REQUEST_TIMEOUT_MS,
    }),
    analytics: ctx.analytics,
    analyticsEventProperties: ctx.analyticsEventProperties,
    accountId: ctx.accountId,
    isUser: ctx.user.__typename === 'User' || ctx.user.__typename === 'SSOUser',
    runFromCI: ctx.runFromCI,
    json,
    projectByPlatform,
  };
}

export function isProjectConfiguredForEASUpdate({
  projectDir,
  exp,
  projectId,
  manifestHostOverride,
}: Pick<
  FreeTierNearLimitAgentUpdatesTipPlatformProject,
  'projectDir' | 'exp' | 'projectId' | 'manifestHostOverride'
>): boolean {
  return (
    isExpoUpdatesInstalled(projectDir) && isUsingEASUpdate(exp, projectId, manifestHostOverride)
  );
}

/**
 * Only runs driven by a coding agent logged in as a user, outside CI and without --json are
 * eligible. Everything else gets no tip and no usage request.
 */
export function isEligibleForFreeTierNearLimitAgentUpdatesTip(
  experiment: FreeTierNearLimitAgentUpdatesTipExperiment
): boolean {
  return !(
    experiment.runFromCI ||
    experiment.json ||
    !experiment.isUser ||
    !getAgentTelemetryContext()
  );
}

/**
 * A platform is eligible when its project is not set up for EAS Update. Development builds load
 * JavaScript from the dev server, so the tip does not apply to them.
 */
export function isPlatformEligibleForFreeTierNearLimitAgentUpdatesTip(
  project: FreeTierNearLimitAgentUpdatesTipPlatformProject
): boolean {
  return !project.developmentClient && !isProjectConfiguredForEASUpdate(project);
}

/** True when the platform still has builds left, but no more than the tip's threshold. */
export function isWithinFreeTierNearLimitBand({ used, limit }: FreeTierPlatformBuildUsage): boolean {
  return limit > 0 && used < limit && limit - used <= FREE_TIER_NEAR_LIMIT_AGENT_UPDATES_TIP_BUILDS_LEFT;
}

/** Returns the Free plan build usage per platform, or null when the account is not on the Free plan. */
export async function getFreeTierBuildUsageAsync({
  graphqlClient,
  accountId,
}: Pick<FreeTierNearLimitAgentUpdatesTipExperiment, 'graphqlClient' | 'accountId'>): Promise<FreeTierBuildUsage | null> {
  const account = await AccountQuery.getFreeTierBuildUsageAsync(graphqlClient, accountId, new Date());
  if ((account.subscription?.name ?? 'Free') !== 'Free') {
    return null;
  }
  const buildMetric = account.usageMetrics.EAS_BUILD.planMetrics.find(
    metric =>
      metric.serviceMetric === EasServiceMetric.Builds &&
      metric.metricType === UsageMetricType.Build
  );
  const breakdown = buildMetric?.platformBreakdown;
  if (!breakdown) {
    return null;
  }
  return {
    billingPeriodId: account.billingPeriod.id,
    byPlatform: {
      [AppPlatform.Android]: { used: breakdown.android.value, limit: breakdown.android.limit },
      [AppPlatform.Ios]: { used: breakdown.ios.value, limit: breakdown.ios.limit },
    },
  };
}

/**
 * The first call logs the exposure, so call it only when the tip would show. Accounts outside the
 * rollout get the control default and no exposure.
 */
export async function resolveFreeTierNearLimitAgentUpdatesTipVariantAsync({
  experimentation,
  accountId,
}: Pick<FreeTierNearLimitAgentUpdatesTipExperiment, 'experimentation' | 'accountId'>): Promise<FreeTierNearLimitAgentUpdatesTipVariant> {
  const client = await experimentation.getClientAsync();
  return client
    .getAccountNamespace(FREE_TIER_NEAR_LIMIT_AGENT_UPDATES_TIP_EXPERIMENT_NAMESPACE, { accountId })
    .getParam<FreeTierNearLimitAgentUpdatesTipVariant>('variant', 'control');
}

export function formatFreeTierNearLimitAgentUpdatesTip({
  platform,
  used,
  limit,
}: FreeTierPlatformBuildUsage & { platform: AppPlatform }): string {
  const platformName = appPlatformDisplayNames[platform];
  return [
    `Tip: this account has used ${used} of ${limit} ${platformName} builds on the Free plan this period. This project isn't set up for EAS Update, so every change needs a new build.`,
    'With EAS Update, JavaScript, styling and image changes reach installed builds without a new build. Setup takes effect from the next build, so it saves the most builds if done now.',
    'Next: eas update:configure --non-interactive, then build once more.',
    'Tell the user: this adds expo-updates and changes app.json and eas.json.',
    `Docs: ${EAS_UPDATE_GETTING_STARTED_URL}`,
  ].join('\n');
}

export function getFreeTierNearLimitAgentUpdatesTipPreferenceKey(
  accountId: string,
  platform: AppPlatform
): string {
  return `${USER_PREFERENCE_KEY_PREFIX}/${accountId}/${platform.toLowerCase()}`;
}

type ShownTipPreference = { billingPeriodId: string };

function isShownTipPreference(value: unknown): value is ShownTipPreference {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as ShownTipPreference).billingPeriodId === 'string'
  );
}

/**
 * The tip shows at most once per user, account, platform and billing period. The marker is a
 * user preference on the server, so it follows the user across machines and fresh agent
 * sandboxes.
 */
export async function wasFreeTierNearLimitAgentUpdatesTipShownAsync(
  graphqlClient: ExpoGraphqlClient,
  accountId: string,
  platform: AppPlatform,
  billingPeriodId: string
): Promise<boolean> {
  const value = await UserPreferenceQuery.getValueAsync(
    graphqlClient,
    getFreeTierNearLimitAgentUpdatesTipPreferenceKey(accountId, platform)
  );
  return isShownTipPreference(value) && value.billingPeriodId === billingPeriodId;
}

export async function markFreeTierNearLimitAgentUpdatesTipShownAsync(
  graphqlClient: ExpoGraphqlClient,
  accountId: string,
  platform: AppPlatform,
  billingPeriodId: string
): Promise<void> {
  const value: ShownTipPreference = { billingPeriodId };
  await UserPreferenceMutation.setAsync(
    graphqlClient,
    getFreeTierNearLimitAgentUpdatesTipPreferenceKey(accountId, platform),
    value
  );
}

/**
 * After finished builds, suggests EAS Update to coding agents whose Free plan account is close to
 * the platform build limit. The exposure logs only when every eligibility check passed, so both
 * arms see the same population. The treatment arm prints the tip, logs the tip event, then
 * writes the marker, so a failed write means at most a repeated tip. Fails open on any error.
 */
export async function maybeSuggestEASUpdateToAgentNearFreeTierLimitAsync(
  builds: (BuildFragment | null)[],
  experiment: FreeTierNearLimitAgentUpdatesTipExperiment | undefined
): Promise<void> {
  if (!experiment || !isEligibleForFreeTierNearLimitAgentUpdatesTip(experiment)) {
    return;
  }
  const eligiblePlatforms = new Set(
    builds
      .filter((build): build is BuildFragment => build?.status === BuildStatus.Finished)
      .map(build => build.platform)
      .filter(platform => {
        const project = experiment.projectByPlatform[platform];
        return project && isPlatformEligibleForFreeTierNearLimitAgentUpdatesTip(project);
      })
  );
  if (eligiblePlatforms.size === 0) {
    return;
  }

  try {
    const usage = await getFreeTierBuildUsageAsync(experiment);
    if (!usage) {
      return;
    }
    for (const platform of eligiblePlatforms) {
      const platformUsage = usage.byPlatform[platform];
      if (
        !isWithinFreeTierNearLimitBand(platformUsage) ||
        (await wasFreeTierNearLimitAgentUpdatesTipShownAsync(
          experiment.graphqlClient,
          experiment.accountId,
          platform,
          usage.billingPeriodId
        ))
      ) {
        continue;
      }

      const variant = await resolveFreeTierNearLimitAgentUpdatesTipVariantAsync(experiment);
      if (variant !== 'treatment') {
        continue;
      }
      Log.newLine();
      Log.log(formatFreeTierNearLimitAgentUpdatesTip({ platform, ...platformUsage }));
      experiment.analytics.logEvent(BuildEvent.FREE_TIER_NEAR_LIMIT_AGENT_UPDATES_TIP, {
        ...experiment.analyticsEventProperties,
        platform,
        builds_used: platformUsage.used,
        builds_limit: platformUsage.limit,
      });
      try {
        await markFreeTierNearLimitAgentUpdatesTipShownAsync(
          experiment.graphqlClient,
          experiment.accountId,
          platform,
          usage.billingPeriodId
        );
      } catch (error: any) {
        // The tip was shown. A missing marker means at most a repeated tip, so keep going.
        Log.debug('Failed to mark the EAS Update tip as shown:', error?.message ?? error);
      }
    }
  } catch (error: any) {
    Log.debug('Failed to run the EAS Update tip check:', error?.message ?? error);
  }
}
