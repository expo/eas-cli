import chalk from 'chalk';

import Log, { link } from '../../log';

export enum PlanType {
  Free = 'Free',
  Starter = 'Starter',
}

export function createProgressBar(percentUsed: number, width: number = 20): string {
  const filledWidth = Math.round((percentUsed / 100) * width);
  const emptyWidth = width - filledWidth;
  const filled = '█'.repeat(filledWidth);
  const empty = '░'.repeat(emptyWidth);
  return `[${filled}${empty}] ${percentUsed}%`;
}

export function displayOverageWarning({
  percentUsed,
  printedMetric,
  planType,
  name,
}: {
  percentUsed: number;
  printedMetric: string;
  planType: PlanType;
  name: string;
}): void {
  Log.warn(chalk.bold(`Usage Alert:`));
  Log.warn(`  ${createProgressBar(percentUsed)} of your included ${printedMetric} used this month`);

  const billingUrl = `https://expo.dev/accounts/${name}/settings/billing`;

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
