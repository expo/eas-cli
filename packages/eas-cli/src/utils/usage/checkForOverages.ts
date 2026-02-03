import chalk from 'chalk';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { AccountQuery } from '../../graphql/queries/AccountQuery';
import Log, { link } from '../../log';

const THRESHOLD_PERCENT = 85;

export async function maybeWarnAboutUsageOveragesAsync({
  graphqlClient,
  accountId,
}: {
  graphqlClient: ExpoGraphqlClient;
  accountId: string;
}): Promise<void> {
  try {
    const currentDate = new Date();
    const {
      name,
      subscription,
      usageMetrics: { EAS_BUILD },
    } = await AccountQuery.getUsageForOverageWarningAsync(graphqlClient, accountId, currentDate);

    const planMetric = EAS_BUILD?.planMetrics?.[0];
    if (!planMetric || !subscription) {
      return;
    }

    const percentUsed = calculatePercentUsed(planMetric.value, planMetric.limit);
    if (percentUsed >= THRESHOLD_PERCENT && percentUsed < 100) {
      const hasFreePlan = subscription.name === 'Free';
      displayOverageWarning({ percentUsed, hasFreePlan, name });
    }
  } catch (error) {
    // Silently fail if we can't fetch usage data - we don't want to block the user's workflow
    Log.debug(`Failed to fetch usage data: ${error}`);
  }
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

export function displayOverageWarning({
  percentUsed,
  hasFreePlan,
  name,
}: {
  percentUsed: number;
  hasFreePlan: boolean;
  name: string;
}): void {
  Log.warn(
    chalk.bold(`You've used ${percentUsed}% of your included build credits for this month. `) +
      createProgressBar(percentUsed)
  );

  const billingUrl = `https://expo.dev/accounts/${name}/settings/billing`;
  const warning = hasFreePlan
    ? "You won't be able to start new builds once you reach the limit. " +
      link(billingUrl, { text: 'Upgrade your plan to continue service.', dim: false })
    : 'Additional usage beyond your limit will be charged at pay-as-you-go rates. ' +
      link(billingUrl, {
        text: 'See usage in billing.',
        dim: false,
      });

  Log.warn(warning);
}
