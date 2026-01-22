import { Flags } from '@oclif/core';
import chalk from 'chalk';

import EasCommand from '../../commandUtils/EasCommand';
import { EasNonInteractiveAndJsonFlags } from '../../commandUtils/flags';
import {
  AppPlatform,
  EasBuildBillingResourceClass,
  EasServiceMetric,
  UsageMetricType,
} from '../../graphql/generated';
import {
  AccountFullUsageData,
  AccountFullUsageQuery,
} from '../../graphql/queries/AccountFullUsageQuery';
import Log from '../../log';
import { ora } from '../../ora';
import { selectAsync } from '../../prompts';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';
import { calculatePercentUsed, createProgressBar } from '../../utils/usage/checkForOverages';

/**
 * Billing heuristics for estimating costs.
 * Based on published EAS pricing (https://expo.dev/pricing)
 */
const BILLING_HEURISTICS = {
  // EAS Update pricing
  UPDATE_MAU_OVERAGE_RATE_CENTS: 0.5, // $0.005 per MAU overage
  UPDATE_BANDWIDTH_OVERAGE_RATE_CENTS: 10, // $0.10 per GiB

  // EAS Build pricing by platform and resource class (in cents)
  BUILD_RATES: {
    [AppPlatform.Ios]: {
      [EasBuildBillingResourceClass.Medium]: 200, // $2.00 per iOS medium build
      [EasBuildBillingResourceClass.Large]: 400, // $4.00 per iOS large build
    },
    [AppPlatform.Android]: {
      [EasBuildBillingResourceClass.Medium]: 100, // $1.00 per Android medium build
      [EasBuildBillingResourceClass.Large]: 200, // $2.00 per Android large build
    },
  },
};

interface UsageMetricDisplay {
  name: string;
  value: number;
  limit: number;
  percentUsed: number;
  overageValue?: number;
  overageCost?: number;
  unit?: string;
}

interface BuildOverageByWorkerSize {
  platform: AppPlatform;
  resourceClass: EasBuildBillingResourceClass;
  count: number;
  costCents: number;
}

interface UsageDisplayData {
  accountName: string;
  subscriptionPlan: string;
  billingPeriod: {
    start: string;
    end: string;
  };
  builds: {
    total: UsageMetricDisplay;
    ios?: UsageMetricDisplay;
    android?: UsageMetricDisplay;
    overagesByWorkerSize: BuildOverageByWorkerSize[];
    overageCostCents: number;
  };
  updates: {
    mau: UsageMetricDisplay;
    bandwidth: UsageMetricDisplay;
    overageCostCents: number;
  };
  totalOverageCostCents: number;
  estimatedBillCents: number;
  recurringCents: number | null;
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatCurrency(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatNumber(value: number, decimals: number = 0): string {
  if (decimals === 0) {
    return Math.round(value).toLocaleString();
  }
  return value.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function calculateDaysRemaining(endDate: string): number {
  const end = new Date(endDate);
  const now = new Date();
  const diffTime = end.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
}

function calculateDaysElapsed(startDate: string): number {
  const start = new Date(startDate);
  const now = new Date();
  const diffTime = now.getTime() - start.getTime();
  return Math.max(1, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
}

function calculateBillingPeriodDays(startDate: string, endDate: string): number {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const diffTime = end.getTime() - start.getTime();
  return Math.max(1, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
}

/**
 * Estimates end-of-cycle usage based on current usage rate.
 * Uses simple linear projection: (current_usage / days_elapsed) * total_days
 */
function estimateEndOfCycleUsage(
  currentValue: number,
  daysElapsed: number,
  totalDays: number
): number {
  if (daysElapsed === 0) {
    return currentValue;
  }
  const dailyRate = currentValue / daysElapsed;
  return dailyRate * totalDays;
}

/**
 * Estimates overage costs based on projected end-of-cycle usage.
 */
function estimateOverageCost(
  projectedUsage: number,
  limit: number,
  ratePerUnitCents: number
): number {
  const overage = Math.max(0, projectedUsage - limit);
  return overage * ratePerUnitCents;
}

function extractUsageData(data: AccountFullUsageData): UsageDisplayData {
  const { name, subscription, billingPeriod, usageMetrics } = data;
  const { EAS_BUILD, EAS_UPDATE } = usageMetrics;

  // Find build metrics
  const buildMetric = EAS_BUILD.planMetrics.find(
    m => m.serviceMetric === EasServiceMetric.Builds && m.metricType === UsageMetricType.Build
  );

  // Extract build overages by worker size from overage metrics with metadata
  const overagesByWorkerSize: BuildOverageByWorkerSize[] = [];
  for (const overage of EAS_BUILD.overageMetrics) {
    if (
      overage.serviceMetric === EasServiceMetric.Builds &&
      overage.metadata?.billingResourceClass &&
      overage.metadata?.platform
    ) {
      overagesByWorkerSize.push({
        platform: overage.metadata.platform,
        resourceClass: overage.metadata.billingResourceClass,
        count: overage.value,
        costCents: overage.totalCost,
      });
    }
  }

  // Find update metrics
  const mauMetric = EAS_UPDATE.planMetrics.find(
    m => m.serviceMetric === EasServiceMetric.UniqueUsers && m.metricType === UsageMetricType.User
  );
  const bandwidthMetric = EAS_UPDATE.planMetrics.find(
    m =>
      m.serviceMetric === EasServiceMetric.BandwidthUsage &&
      m.metricType === UsageMetricType.Bandwidth
  );
  const mauOverage = EAS_UPDATE.overageMetrics.find(
    m => m.serviceMetric === EasServiceMetric.UniqueUsers
  );
  const bandwidthOverage = EAS_UPDATE.overageMetrics.find(
    m => m.serviceMetric === EasServiceMetric.BandwidthUsage
  );

  const buildValue = buildMetric?.value ?? 0;
  const buildLimit = buildMetric?.limit ?? 0;
  const iosBuildValue = buildMetric?.platformBreakdown?.ios.value ?? 0;
  const iosBuildLimit = buildMetric?.platformBreakdown?.ios.limit ?? 0;
  const androidBuildValue = buildMetric?.platformBreakdown?.android.value ?? 0;
  const androidBuildLimit = buildMetric?.platformBreakdown?.android.limit ?? 0;

  const mauValue = mauMetric?.value ?? 0;
  const mauLimit = mauMetric?.limit ?? 0;
  const bandwidthValue = bandwidthMetric?.value ?? 0;
  const bandwidthLimit = bandwidthMetric?.limit ?? 0;

  const buildOverageCostCents = EAS_BUILD.totalCost;
  const updateOverageCostCents = EAS_UPDATE.totalCost;
  const totalOverageCostCents = buildOverageCostCents + updateOverageCostCents;

  // Calculate total overage count for display
  const totalOverageBuilds = overagesByWorkerSize.reduce((sum, o) => sum + o.count, 0);

  return {
    accountName: name,
    subscriptionPlan: subscription?.name ?? 'Free',
    billingPeriod: {
      start: billingPeriod.start,
      end: billingPeriod.end,
    },
    builds: {
      total: {
        name: 'Builds',
        value: buildValue,
        limit: buildLimit,
        percentUsed: calculatePercentUsed(buildValue, buildLimit),
        overageValue: totalOverageBuilds > 0 ? totalOverageBuilds : undefined,
        overageCost: buildOverageCostCents > 0 ? buildOverageCostCents : undefined,
        unit: 'builds',
      },
      ios: buildMetric?.platformBreakdown
        ? {
            name: 'iOS Builds',
            value: iosBuildValue,
            limit: iosBuildLimit,
            percentUsed: calculatePercentUsed(iosBuildValue, iosBuildLimit),
            unit: 'builds',
          }
        : undefined,
      android: buildMetric?.platformBreakdown
        ? {
            name: 'Android Builds',
            value: androidBuildValue,
            limit: androidBuildLimit,
            percentUsed: calculatePercentUsed(androidBuildValue, androidBuildLimit),
            unit: 'builds',
          }
        : undefined,
      overagesByWorkerSize,
      overageCostCents: buildOverageCostCents,
    },
    updates: {
      mau: {
        name: 'Monthly Active Users',
        value: mauValue,
        limit: mauLimit,
        percentUsed: calculatePercentUsed(mauValue, mauLimit),
        overageValue: mauOverage?.value,
        overageCost: mauOverage?.totalCost,
        unit: 'users',
      },
      bandwidth: {
        name: 'Bandwidth',
        value: bandwidthValue,
        limit: bandwidthLimit,
        percentUsed: calculatePercentUsed(bandwidthValue, bandwidthLimit),
        overageValue: bandwidthOverage?.value,
        overageCost: bandwidthOverage?.totalCost,
        unit: 'GiB',
      },
      overageCostCents: updateOverageCostCents,
    },
    totalOverageCostCents,
    estimatedBillCents: (subscription?.recurringCents ?? 0) + totalOverageCostCents,
    recurringCents: subscription?.recurringCents ?? null,
  };
}

function calculateProjectedCosts(data: UsageDisplayData): {
  projectedOverageCents: number;
  projectedTotalCents: number;
  daysRemaining: number;
  daysElapsed: number;
  totalDays: number;
} {
  const daysElapsed = calculateDaysElapsed(data.billingPeriod.start);
  const totalDays = calculateBillingPeriodDays(data.billingPeriod.start, data.billingPeriod.end);
  const daysRemaining = calculateDaysRemaining(data.billingPeriod.end);

  // Project build usage
  const projectedBuilds = estimateEndOfCycleUsage(data.builds.total.value, daysElapsed, totalDays);
  const projectedIosBuilds = data.builds.ios
    ? estimateEndOfCycleUsage(data.builds.ios.value, daysElapsed, totalDays)
    : 0;
  const projectedAndroidBuilds = data.builds.android
    ? estimateEndOfCycleUsage(data.builds.android.value, daysElapsed, totalDays)
    : 0;

  // Project update usage
  const projectedMau = estimateEndOfCycleUsage(data.updates.mau.value, daysElapsed, totalDays);
  const projectedBandwidth = estimateEndOfCycleUsage(
    data.updates.bandwidth.value,
    daysElapsed,
    totalDays
  );

  // Estimate overage costs using heuristics
  // For builds, if we have current overage data with worker size breakdown, use it to
  // estimate the worker size distribution. Otherwise, use medium as default.
  let projectedBuildOverage = 0;
  if (projectedBuilds > data.builds.total.limit) {
    const totalProjectedOverage = projectedBuilds - data.builds.total.limit;

    // Calculate weighted average rate based on current overage distribution
    if (data.builds.overagesByWorkerSize.length > 0) {
      // Use actual distribution from current overages
      const totalCurrentOverages = data.builds.overagesByWorkerSize.reduce(
        (sum, o) => sum + o.count,
        0
      );
      if (totalCurrentOverages > 0) {
        const weightedRate = data.builds.overagesByWorkerSize.reduce((sum, o) => {
          const rate = BILLING_HEURISTICS.BUILD_RATES[o.platform]?.[o.resourceClass] ?? 150; // fallback
          return sum + (o.count / totalCurrentOverages) * rate;
        }, 0);
        projectedBuildOverage = totalProjectedOverage * weightedRate;
      }
    } else {
      // No current overages, estimate based on platform distribution using medium rates
      const iosRatio =
        projectedBuilds > 0
          ? projectedIosBuilds / (projectedIosBuilds + projectedAndroidBuilds)
          : 0.5;
      const iosOverage = totalProjectedOverage * iosRatio;
      const androidOverage = totalProjectedOverage * (1 - iosRatio);
      projectedBuildOverage =
        iosOverage *
          BILLING_HEURISTICS.BUILD_RATES[AppPlatform.Ios][EasBuildBillingResourceClass.Medium] +
        androidOverage *
          BILLING_HEURISTICS.BUILD_RATES[AppPlatform.Android][EasBuildBillingResourceClass.Medium];
    }
  }

  const projectedMauOverage = estimateOverageCost(
    projectedMau,
    data.updates.mau.limit,
    BILLING_HEURISTICS.UPDATE_MAU_OVERAGE_RATE_CENTS
  );
  const projectedBandwidthOverage = estimateOverageCost(
    projectedBandwidth,
    data.updates.bandwidth.limit,
    BILLING_HEURISTICS.UPDATE_BANDWIDTH_OVERAGE_RATE_CENTS
  );

  const projectedOverageCents = Math.max(
    data.totalOverageCostCents,
    projectedBuildOverage + projectedMauOverage + projectedBandwidthOverage
  );

  const projectedTotalCents = (data.recurringCents ?? 0) + projectedOverageCents;

  return {
    projectedOverageCents,
    projectedTotalCents,
    daysRemaining,
    daysElapsed,
    totalDays,
  };
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
  displayMetric(data.updates.bandwidth);

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

  static override flags = {
    account: Flags.string({
      description:
        'Account name to view usage for. If not provided, the account will be selected interactively (or defaults to the only account if there is just one)',
    }),
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const {
      flags: { account: accountName, json: jsonFlag, 'non-interactive': nonInteractive },
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
    let targetAccount: typeof defaultAccount;

    if (accountName) {
      const found = actor.accounts.find(a => a.name === accountName);
      if (!found) {
        const availableAccounts = actor.accounts.map(a => a.name).join(', ');
        throw new Error(
          `Account "${accountName}" not found. Available accounts: ${availableAccounts}`
        );
      }
      targetAccount = found;
    } else if (nonInteractive) {
      throw new Error(
        'The `--account` flag must be set when running in `--non-interactive` mode.'
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
      const usageData = await AccountFullUsageQuery.getFullUsageAsync(
        graphqlClient,
        targetAccount.id,
        currentDate
      );

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
            bandwidthGiB: {
              used: displayData.updates.bandwidth.value,
              limit: displayData.updates.bandwidth.limit,
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
