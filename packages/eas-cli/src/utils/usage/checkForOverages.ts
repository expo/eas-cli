import chalk from 'chalk';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { AccountQuery } from '../../graphql/queries/AccountQuery';
import Log, { link } from '../../log';

const APPROACHING_THRESHOLD_PERCENT = 80;

export type UsageTier = 'approaching' | 'at' | 'over';

export async function maybeWarnAboutUsageOveragesAsync({
  graphqlClient,
  accountId,
}: {
  graphqlClient: ExpoGraphqlClient;
  accountId: string;
}): Promise<void> {
  try {
    const currentDate = new Date();
    const account = await AccountQuery.getUsageForOverageWarningAsync(
      graphqlClient,
      accountId,
      currentDate
    );
    if (!account) {
      return;
    }

    const { name, subscription, usageMetrics } = account;
    const buildMetrics = usageMetrics.EAS_BUILD;
    const planMetric = buildMetrics?.planMetrics?.[0];
    if (!planMetric || !subscription) {
      return;
    }

    const overageCount = buildMetrics.overageMetrics.reduce((sum, o) => sum + o.value, 0);
    const overageCostCents = buildMetrics.totalCost;
    const hasFreePlan = subscription.name === 'Free';
    const tier = classifyUsageTier({
      planValue: planMetric.value,
      limit: planMetric.limit,
      overageCount,
      overageCostCents,
      hasFreePlan,
    });
    if (!tier) {
      return;
    }

    displayOverageWarning({
      tier,
      name,
      hasFreePlan,
      planValue: planMetric.value,
      limit: planMetric.limit,
      overageCount,
      overageCostCents,
    });
  } catch (error) {
    // Silently fail if we can't fetch usage data - we don't want to block the user's workflow
    Log.debug(`Failed to fetch usage data: ${error}`);
  }
}

export function classifyUsageTier({
  planValue,
  limit,
  overageCount,
  overageCostCents,
  hasFreePlan,
}: {
  planValue: number;
  limit: number;
  overageCount: number;
  overageCostCents: number;
  hasFreePlan: boolean;
}): UsageTier | null {
  // Only paid plans can incur pay-as-you-go overages, and only when there is an
  // actual billable cost. Free plans are blocked at the limit and are never charged,
  // so they can never be in an "over" state — a nonzero overage row (e.g. a usage
  // rollup returned by the API) must not be treated as billable usage. Without this
  // guard, free users well below their limit were shown a "you've reached your limit,
  // upgrade to keep building" warning.
  if (!hasFreePlan && overageCount > 0 && overageCostCents > 0) {
    return 'over';
  }
  if (limit > 0 && planValue >= limit) {
    return 'at';
  }
  const percentUsed = calculatePercentUsed(planValue, limit);
  if (percentUsed >= APPROACHING_THRESHOLD_PERCENT) {
    return 'approaching';
  }
  return null;
}

export function calculatePercentUsed(value: number, limit: number): number {
  if (limit === 0) {
    return 0;
  }
  return Math.min(Math.floor((value / limit) * 100), 100);
}

export function createProgressBar(percentUsed: number, width: number = 30): string {
  const filledWidth = Math.round((percentUsed / 100) * width);
  const emptyWidth = width - filledWidth;
  const filled = '█'.repeat(filledWidth);
  const empty = '░'.repeat(emptyWidth);
  return `${filled}${empty}`;
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function displayOverageWarning({
  tier,
  name,
  hasFreePlan,
  planValue,
  limit,
  overageCount,
  overageCostCents,
}: {
  tier: UsageTier;
  name: string;
  hasFreePlan: boolean;
  planValue: number;
  limit: number;
  overageCount: number;
  overageCostCents: number;
}): void {
  const billingUrl = `https://expo.dev/accounts/${name}/settings/billing`;

  if (tier === 'approaching') {
    const percentUsed = calculatePercentUsed(planValue, limit);
    Log.warn(
      chalk.bold(
        `You've used ${percentUsed}% of your included build credits this billing period.`
      ) +
        ' ' +
        createProgressBar(percentUsed)
    );
    Log.warn(
      hasFreePlan
        ? "You won't be able to start new builds once you reach the limit. " +
            link(billingUrl, { text: 'Upgrade your plan to continue service.', dim: false })
        : 'Additional usage beyond your limit will be charged at pay-as-you-go rates. ' +
            link(billingUrl, { text: 'See usage in billing.', dim: false })
    );
    return;
  }

  // Free users are blocked at the limit, so they can't reach an "over" state.
  // If we ever see Free + over (data inconsistency, mid-flight plan change), treat it as "at".
  if (tier === 'at' || (tier === 'over' && hasFreePlan)) {
    Log.warn(chalk.bold("You've reached your included build credits this billing period."));
    Log.warn(
      hasFreePlan
        ? 'New builds are blocked until your billing period resets. ' +
            link(billingUrl, { text: 'Upgrade your plan to continue building.', dim: false })
        : 'Additional builds will be charged at pay-as-you-go rates. ' +
            link(billingUrl, { text: 'See usage in billing.', dim: false })
    );
    return;
  }

  // tier === 'over' && paid plan
  Log.warn(
    chalk.bold(
      `You've used ${overageCount} build${overageCount === 1 ? '' : 's'} beyond your included credits this billing period (${formatCents(overageCostCents)} in overages so far).`
    )
  );
  Log.warn(
    'Additional builds continue at pay-as-you-go rates. ' +
      link(billingUrl, { text: 'See usage in billing.', dim: false })
  );
}
