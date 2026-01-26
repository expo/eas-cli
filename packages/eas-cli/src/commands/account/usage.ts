import chalk from 'chalk';

import EasCommand from '../../commandUtils/EasCommand';
import { EASNonInteractiveFlag, EasJsonOnlyFlag } from '../../commandUtils/flags';
import {
  UsageDisplayData,
  UsageMetricDisplay,
  calculateBillingPeriodInfo,
  extractUsageData,
  formatCurrency,
  formatDate,
  formatNumber,
} from '../../commandUtils/usageUtils';
import { AppPlatform, EasBuildBillingResourceClass } from '../../graphql/generated';
import { AccountFullUsageData, AccountQuery } from '../../graphql/queries/AccountQuery';
import Log, { link } from '../../log';
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
  const planUsageStr = `${formatBytesDisplay(metric.planValue)}/${formatBytesDisplay(
    metric.limit
  )}`;

  let color = chalk.green;
  if (metric.percentUsed >= 100) {
    color = chalk.red;
  } else if (metric.percentUsed >= 85) {
    color = chalk.yellow;
  }

  Log.log(`${indent}${metric.name} (plan): ${color(planUsageStr)}`);
  Log.log(`${indent}${progressBar} ${color(percentStr)}`);

  if (metric.overageValue > 0) {
    Log.log(
      `${indent}${metric.name} (overage): ${chalk.red(
        formatBytesDisplay(metric.overageValue)
      )} (${formatCurrency(metric.overageCost)})`
    );
  }
}

function displayMetric(metric: UsageMetricDisplay, indent: string = '  '): void {
  const progressBar = createProgressBar(metric.percentUsed, 20);
  const percentStr = `${metric.percentUsed}%`;
  const planUsageStr = `${formatNumber(metric.planValue)}/${formatNumber(metric.limit)} ${
    metric.unit ?? ''
  }`;

  let color = chalk.green;
  if (metric.percentUsed >= 100) {
    color = chalk.red;
  } else if (metric.percentUsed >= 85) {
    color = chalk.yellow;
  }

  Log.log(`${indent}${metric.name} (plan): ${color(planUsageStr)}`);
  Log.log(`${indent}${progressBar} ${color(percentStr)}`);

  if (metric.overageValue > 0) {
    Log.log(
      `${indent}${metric.name} (overage): ${chalk.red(
        `${formatNumber(metric.overageValue)} ${metric.unit ?? ''}`
      )} (${formatCurrency(metric.overageCost)})`
    );
  }
}

function billingUrl(accountName: string): string {
  return `https://expo.dev/accounts/${accountName}/settings/billing`;
}

function displayUsage(data: UsageDisplayData, usageData: AccountFullUsageData): void {
  const subscription = usageData.subscription;

  Log.newLine();
  Log.log(chalk.bold(`Account: ${data.accountName}`));
  Log.log(`Plan: ${data.subscriptionPlan}`);
  if (subscription?.concurrencies) {
    Log.log(
      `Concurrencies: ${subscription.concurrencies.total} total (iOS: ${subscription.concurrencies.ios}, Android: ${subscription.concurrencies.android})`
    );
  }
  Log.log(
    `Billing Period: ${formatDate(data.billingPeriod.start)} - ${formatDate(
      data.billingPeriod.end
    )}`
  );

  const periodInfo = calculateBillingPeriodInfo(data);
  Log.log(
    `Days: ${periodInfo.daysElapsed} elapsed / ${periodInfo.totalDays} total (${periodInfo.daysRemaining} remaining)`
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

  // Show build counts by platform and worker size
  if (data.builds.countsByPlatformAndSize.length > 0) {
    Log.log('  Breakdown by platform/worker:');
    for (const item of data.builds.countsByPlatformAndSize) {
      const platformName = item.platform === 'ios' ? 'iOS' : 'Android';
      Log.log(`    ${platformName} ${item.resourceClass}: ${formatNumber(item.count)} builds`);
    }
  }

  Log.newLine();
  Log.log(chalk.bold.underline('EAS Update'));
  displayMetric(data.updates.mau);
  displayBandwidthMetric(data.updates.bandwidth);

  Log.newLine();
  Log.log(chalk.bold.underline('Billing'));

  const upcomingInvoice = subscription?.upcomingInvoice;

  // Show subscription addons
  if (subscription?.addons && subscription.addons.length > 0) {
    Log.log('  Addons:');
    for (const addon of subscription.addons) {
      Log.log(`    ${addon.name}: ${addon.quantity}`);
    }
  }

  // Show upcoming invoice line items
  if (upcomingInvoice?.lineItems && upcomingInvoice.lineItems.length > 0) {
    Log.newLine();
    Log.log('  Upcoming invoice:');
    for (const lineItem of upcomingInvoice.lineItems) {
      const amount = lineItem.amount;
      const amountStr = amount < 0 ? chalk.green(formatCurrency(amount)) : formatCurrency(amount);
      Log.log(`    ${lineItem.description}: ${amountStr}`);
    }
    Log.newLine();
    Log.log(`  Invoice total: ${chalk.bold(formatCurrency(upcomingInvoice.total))}`);
  } else {
    // Fallback to the calculated estimate if no upcoming invoice
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

    Log.log(`  Estimated bill: ${chalk.bold(formatCurrency(data.estimatedBillCents))}`);
  }

  Log.newLine();
  Log.log(chalk.dim(`View detailed billing: ${link(billingUrl(data.accountName))}`));
}

export default class AccountUsage extends EasCommand {
  static override description = 'view account usage and billing for the current cycle';

  static override args = [
    {
      name: 'ACCOUNT_NAME',
      description:
        'Account name to view usage for. If not provided, the account will be selected interactively (or defaults to the only account if there is just one)',
    },
  ];

  static override flags = {
    ...EasJsonOnlyFlag,
    ...EASNonInteractiveFlag,
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
      const { start, end } = await AccountQuery.getBillingPeriodAsync(
        graphqlClient,
        targetAccount.id,
        currentDate
      );
      const usageData = await AccountQuery.getFullUsageAsync(
        graphqlClient,
        targetAccount.id,
        currentDate,
        start,
        end
      );
      Log.debug(JSON.stringify(usageData, null, 2));

      spinner.succeed(`Usage data loaded for ${targetAccount.name}`);

      const displayData = extractUsageData(usageData);
      const periodInfo = calculateBillingPeriodInfo(displayData);

      if (json) {
        const subscription = usageData.subscription;
        printJsonOnlyOutput({
          account: {
            name: displayData.accountName,
            plan: displayData.subscriptionPlan,
            concurrencies: subscription?.concurrencies ?? null,
            billingPeriod: {
              start: displayData.billingPeriod.start,
              end: displayData.billingPeriod.end,
              daysElapsed: periodInfo.daysElapsed,
              daysRemaining: periodInfo.daysRemaining,
              totalDays: periodInfo.totalDays,
            },
          },
          builds: {
            plan: {
              used: displayData.builds.total.planValue,
              limit: displayData.builds.total.limit,
              percentUsed: displayData.builds.total.percentUsed,
            },
            overage: {
              count: displayData.builds.total.overageValue,
              costCents: displayData.builds.total.overageCost,
              byWorkerSize: displayData.builds.overagesByWorkerSize.map(o => ({
                platform: o.platform.toLowerCase(),
                resourceClass: o.resourceClass.toLowerCase(),
                count: o.count,
                costCents: o.costCents,
              })),
            },
            byPlatformAndSize: displayData.builds.countsByPlatformAndSize.map(item => ({
              platform: item.platform,
              resourceClass: item.resourceClass,
              count: item.count,
            })),
            ios: displayData.builds.ios
              ? {
                  plan: {
                    used: displayData.builds.ios.planValue,
                    limit: displayData.builds.ios.limit,
                    percentUsed: displayData.builds.ios.percentUsed,
                  },
                }
              : null,
            android: displayData.builds.android
              ? {
                  plan: {
                    used: displayData.builds.android.planValue,
                    limit: displayData.builds.android.limit,
                    percentUsed: displayData.builds.android.percentUsed,
                  },
                }
              : null,
          },
          updates: {
            uniqueUpdaters: {
              plan: {
                used: displayData.updates.mau.planValue,
                limit: displayData.updates.mau.limit,
                percentUsed: displayData.updates.mau.percentUsed,
              },
              overage: {
                count: displayData.updates.mau.overageValue,
                costCents: displayData.updates.mau.overageCost,
              },
            },
            bandwidth: {
              plan: {
                usedBytes: displayData.updates.bandwidth.planValue,
                usedFormatted: formatBytesDisplay(displayData.updates.bandwidth.planValue),
                limitBytes: displayData.updates.bandwidth.limit,
                limitFormatted: formatBytesDisplay(displayData.updates.bandwidth.limit),
                percentUsed: displayData.updates.bandwidth.percentUsed,
              },
              overage: {
                usedBytes: displayData.updates.bandwidth.overageValue,
                usedFormatted: formatBytesDisplay(displayData.updates.bandwidth.overageValue),
                costCents: displayData.updates.bandwidth.overageCost,
              },
            },
            overageCostCents: displayData.updates.overageCostCents,
          },
          billing: {
            addons: subscription?.addons ?? [],
            upcomingInvoice: subscription?.upcomingInvoice ?? null,
            estimated: {
              recurringCents: displayData.recurringCents,
              overageCents: displayData.totalOverageCostCents,
              totalCents: displayData.estimatedBillCents,
            },
          },
          billingUrl: billingUrl(displayData.accountName),
        });
      } else {
        displayUsage(displayData, usageData);
      }
    } catch (error) {
      spinner.fail('Failed to fetch usage data');
      throw error;
    }
  }
}
