import chalk from 'chalk';

import { OverageThreshold } from './calculateOverages';
import Log, { link } from '../../log';

export enum PlanType {
  Free = 'Free',
  Starter = 'Starter',
}

export function displayOverageWarning(
  threshold: OverageThreshold,
  planType: PlanType,
  accountName: string
): void {
  Log.warn(
    chalk.bold(
      `You've used ${threshold.percentUsed}% of your ${threshold.printedMetric} this month.`
    )
  );

  const billingUrl = `https://expo.dev/accounts/${accountName}/settings/billing`;

  if (planType === PlanType.Free) {
    Log.warn(`Upgrade your plan to continue service: ${link(billingUrl)}`);
  } else {
    // Starter plan
    Log.warn(
      `Additional usage will be charged at pay-as-you-go rates. ${link(billingUrl, {
        text: 'See usage in billing',
      })}`
    );
  }
}

/**
 * Creates a simple progress bar showing usage percentage
 */
export function createProgressBar(percentUsed: number, width: number = 20): string {
  const filledWidth = Math.round((percentUsed / 100) * width);
  const emptyWidth = width - filledWidth;
  const filled = '█'.repeat(filledWidth);
  const empty = '░'.repeat(emptyWidth);
  return `[${filled}${empty}] ${percentUsed}%`;
}

/**
 * Display overage warning with optional progress bar
 */
export function displayOverageWarningWithProgressBar(
  threshold: OverageThreshold,
  planType: PlanType,
  accountName: string
): void {
  Log.warn(chalk.bold(`Usage Alert:`));
  Log.warn(
    `  ${createProgressBar(threshold.percentUsed)} of your ${
      threshold.printedMetric
    } used this month`
  );

  const billingUrl = `https://expo.dev/accounts/${accountName}/settings/billing`;

  if (planType === PlanType.Free) {
    Log.warn(`  Upgrade your plan to continue service: ${link(billingUrl)}`);
  } else {
    // Starter plan
    Log.warn(
      `  Additional usage will be charged at pay-as-you-go rates. ${link(billingUrl, {
        text: 'See usage in billing',
      })}`
    );
  }
  Log.newLine();
}
