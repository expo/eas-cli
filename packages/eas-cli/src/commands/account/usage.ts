import chalk from 'chalk';

import EasCommand from '../../commandUtils/EasCommand';
import { EasNonInteractiveAndJsonFlags } from '../../commandUtils/flags';
import {
  UsageDisplayData,
  UsageMetricDisplay,
  calculateProjectedCosts,
  extractUsageData,
  formatCurrency,
  formatDate,
  formatNumber,
} from '../../commandUtils/usageUtils';
import { AppPlatform, EasBuildBillingResourceClass } from '../../graphql/generated';
import { AccountQuery } from '../../graphql/queries/AccountQuery';
import Log from '../../log';
import { ora } from '../../ora';
import { selectAsync } from '../../prompts';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';
import { createProgressBar } from '../../utils/usage/checkForOverages';

const MiB = 1024 * 1024;
const GiB = 1024 * MiB;
const TiB = 1024 * GiB;

function formatBytes(bytes: number): { value: number; unit: string } {
  if (bytes >= TiB) {
    return { value: bytes / TiB, unit: 'TiB' };
  } else if (bytes >= GiB) {
    return { value: bytes / GiB, unit: 'GiB' };
  } else {
    return { value: bytes / MiB, unit: 'MiB' };
  }
}

function formatBytesDisplay(bytes: number): string {
  const { value, unit } = formatBytes(bytes);
  return `${formatNumber(value, value < 10 ? 2 : value < 100 ? 1 : 0)} ${unit}`;
}

function displayBandwidthMetric(metric: UsageMetricDisplay, indent: string = '  '): void {
  const progressBar = createProgressBar(metric.percentUsed, 20);
  const percentStr = `${metric.percentUsed}%`;
  const usageStr = `${formatBytesDisplay(metric.value)}/${formatBytesDisplay(metric.limit)}`;

  let color = chalk.green;
  if (metric.percentUsed >= 100) {
    color = chalk.red;
  } else if (metric.percentUsed >= 85) {
    color = chalk.yellow;
  }

  Log.log(`${indent}${metric.name}: ${color(usageStr)}`);
  Log.log(`${indent}${progressBar} ${color(percentStr)}`);

  if (metric.overageCost && metric.overageCost > 0) {
    Log.log(`${indent}${chalk.red(`Overage: ${formatCurrency(metric.overageCost)}`)}`);
  }
}

function displayMetric(metric: UsageMetricDisplay, indent: string = '  '): void {
  const progressBar = createProgressBar(metric.percentUsed, 20);
  const percentStr = `${metric.percentUsed}%`;
  const usageStr = `${formatNumber(metric.value)}/${formatNumber(metric.limit)} ${
    metric.unit ?? ''
  }`;

  let color = chalk.green;
  if (metric.percentUsed >= 100) {
    color = chalk.red;
  } else if (metric.percentUsed >= 85) {
    color = chalk.yellow;
  }

  Log.log(`${indent}${metric.name}: ${color(usageStr)}`);
  Log.log(`${indent}${progressBar} ${color(percentStr)}`);

  if (metric.overageCost && metric.overageCost > 0) {
    Log.log(`${indent}${chalk.red(`Overage: ${formatCurrency(metric.overageCost)}`)}`);
  }
}

function displayUsage(data: UsageDisplayData): void {
  Log.newLine();
  Log.log(chalk.bold(`Account: ${data.accountName}`));
  Log.log(`Plan: ${data.subscriptionPlan}`);
  Log.log(
    `Billing Period: ${formatDate(data.billingPeriod.start)} - ${formatDate(
      data.billingPeriod.end
    )}`
  );

  const projection = calculateProjectedCosts(data);
  Log.log(
    `Days: ${projection.daysElapsed} elapsed / ${projection.totalDays} total (${projection.daysRemaining} remaining)`
  );

  Log.newLine();
  Log.log(chalk.bold.underline('EAS Build'));
  displayMetric(data.builds.total);
  if (data.builds.ios) {
    displayMetric(data.builds.ios, '    ');
  }
  if (data.builds.android) {
    displayMetric(data.builds.android, '    ');
  }

  Log.newLine();
  Log.log(chalk.bold.underline('EAS Update'));
  displayMetric(data.updates.mau);
  displayBandwidthMetric(data.updates.bandwidth);

  Log.newLine();
  Log.log(chalk.bold.underline('Billing Estimate'));

  if (data.recurringCents !== null && data.recurringCents > 0) {
    Log.log(`  Base subscription: ${formatCurrency(data.recurringCents)}`);
  }

  if (data.totalOverageCostCents > 0) {
    Log.log(`  Current overages: ${chalk.yellow(formatCurrency(data.totalOverageCostCents))}`);
    if (data.builds.overageCostCents > 0) {
      Log.log(`    Build overages: ${formatCurrency(data.builds.overageCostCents)}`);
      // Show breakdown by worker size
      for (const overage of data.builds.overagesByWorkerSize) {
        const platformName = overage.platform === AppPlatform.Ios ? 'iOS' : 'Android';
        const sizeName =
          overage.resourceClass === EasBuildBillingResourceClass.Large ? 'large' : 'medium';
        Log.log(
          `      ${platformName} ${sizeName}: ${formatNumber(
            overage.count
          )} builds (${formatCurrency(overage.costCents)})`
        );
      }
    }
    if (data.updates.overageCostCents > 0) {
      Log.log(`    Update overages: ${formatCurrency(data.updates.overageCostCents)}`);
    }
  }

  Log.log(`  Current bill: ${chalk.bold(formatCurrency(data.estimatedBillCents))}`);

  if (projection.daysRemaining > 0) {
    Log.newLine();
    Log.log(chalk.dim('  Projected end-of-cycle (based on current usage rate):'));
    Log.log(chalk.dim(`    Estimated total: ${formatCurrency(projection.projectedTotalCents)}`));
  }

  Log.newLine();
  Log.log(
    chalk.dim(
      `View detailed billing: https://expo.dev/accounts/${data.accountName}/settings/billing`
    )
  );
}

export default class AccountUsage extends EasCommand {
  static override description = 'view account usage and billing estimates for the current cycle';

  static override args = [
    {
      name: 'ACCOUNT_NAME',
      description:
        'Account name to view usage for. If not provided, the account will be selected interactively (or defaults to the only account if there is just one)',
    },
  ];

  static override flags = {
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const {
      args: { ACCOUNT_NAME: accountName },
      flags: { json: jsonFlag, 'non-interactive': nonInteractive },
    } = await this.parse(AccountUsage);

    // Enable JSON output if either --json or --non-interactive is passed
    const json = jsonFlag || nonInteractive;
    if (json) {
      enableJsonOutput();
    }

    const {
      loggedIn: { graphqlClient, actor },
    } = await this.getContextAsync(AccountUsage, {
      nonInteractive,
    });

    // Find the target account
    const defaultAccount = actor.accounts[0];
    let targetAccount: { id: string; name: string };
    const availableAccounts = actor.accounts.map(a => a.name).join(', ');

    if (accountName) {
      // First check if it's one of the user's accounts
      const found = actor.accounts.find(a => a.name === accountName);
      if (found) {
        targetAccount = found;
      } else {
        // Try to look up the account by name (user may have access via organization)
        try {
          const account = await AccountQuery.getByNameAsync(graphqlClient, accountName);
          if (!account) {
            throw new Error(
              `Account "${accountName}" not found. Available accounts: ${availableAccounts}`
            );
          }
          targetAccount = account;
        } catch {
          throw new Error(
            `Account "${accountName}" not found or you don't have access. Available accounts: ${availableAccounts}`
          );
        }
      }
    } else if (nonInteractive) {
      throw new Error(
        'ACCOUNT_NAME argument must be provided when running in `--non-interactive` mode.'
      );
    } else if (actor.accounts.length === 1) {
      // Only one account, use it directly
      targetAccount = defaultAccount;
    } else {
      // Prompt user to select an account
      targetAccount = await selectAsync(
        'Select account to view usage for:',
        actor.accounts.map(account => ({
          title: account.name,
          value: account,
        })),
        { initial: defaultAccount }
      );
    }

    const spinner = ora(`Fetching usage data for account ${targetAccount.name}`).start();

    try {
      const currentDate = new Date();
      const usageData = await AccountQuery.getFullUsageAsync(
        graphqlClient,
        targetAccount.id,
        currentDate
      );
      Log.debug(JSON.stringify(usageData, null, 2));

      spinner.succeed(`Usage data loaded for ${targetAccount.name}`);

      const displayData = extractUsageData(usageData);
      const projection = calculateProjectedCosts(displayData);

      if (json) {
        printJsonOnlyOutput({
          account: displayData.accountName,
          plan: displayData.subscriptionPlan,
          billingPeriod: {
            start: displayData.billingPeriod.start,
            end: displayData.billingPeriod.end,
            daysElapsed: projection.daysElapsed,
            daysRemaining: projection.daysRemaining,
            totalDays: projection.totalDays,
          },
          builds: {
            used: displayData.builds.total.value,
            limit: displayData.builds.total.limit,
            percentUsed: displayData.builds.total.percentUsed,
            ios: displayData.builds.ios
              ? {
                  used: displayData.builds.ios.value,
                  limit: displayData.builds.ios.limit,
                  percentUsed: displayData.builds.ios.percentUsed,
                }
              : null,
            android: displayData.builds.android
              ? {
                  used: displayData.builds.android.value,
                  limit: displayData.builds.android.limit,
                  percentUsed: displayData.builds.android.percentUsed,
                }
              : null,
            overagesByWorkerSize: displayData.builds.overagesByWorkerSize.map(o => ({
              platform: o.platform.toLowerCase(),
              resourceClass: o.resourceClass.toLowerCase(),
              count: o.count,
              costCents: o.costCents,
            })),
            overageCostCents: displayData.builds.overageCostCents,
          },
          updates: {
            mau: {
              used: displayData.updates.mau.value,
              limit: displayData.updates.mau.limit,
              percentUsed: displayData.updates.mau.percentUsed,
              overageCostCents: displayData.updates.mau.overageCost ?? 0,
            },
            bandwidth: {
              usedBytes: displayData.updates.bandwidth.value,
              usedFormatted: formatBytesDisplay(displayData.updates.bandwidth.value),
              limitBytes: displayData.updates.bandwidth.limit,
              limitFormatted: formatBytesDisplay(displayData.updates.bandwidth.limit),
              percentUsed: displayData.updates.bandwidth.percentUsed,
              overageCostCents: displayData.updates.bandwidth.overageCost ?? 0,
            },
            overageCostCents: displayData.updates.overageCostCents,
          },
          billing: {
            recurringCents: displayData.recurringCents,
            currentOverageCents: displayData.totalOverageCostCents,
            currentTotalCents: displayData.estimatedBillCents,
            projectedOverageCents: projection.projectedOverageCents,
            projectedTotalCents: projection.projectedTotalCents,
          },
          billingUrl: `https://expo.dev/accounts/${displayData.accountName}/settings/billing`,
        });
      } else {
        displayUsage(displayData);
      }
    } catch (error) {
      spinner.fail('Failed to fetch usage data');
      throw error;
    }
  }
}
