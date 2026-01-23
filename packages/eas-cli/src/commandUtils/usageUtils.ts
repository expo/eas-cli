import {
  AppPlatform,
  EasBuildBillingResourceClass,
  EasServiceMetric,
  UsageMetricType,
} from '../graphql/generated';
import { AccountFullUsageData } from '../graphql/queries/AccountQuery';
import { calculatePercentUsed } from '../utils/usage/checkForOverages';

export interface UsageMetricDisplay {
  name: string;
  value: number;
  limit: number;
  percentUsed: number;
  overageValue?: number;
  overageCost?: number;
  unit?: string;
}

export interface BuildOverageByWorkerSize {
  platform: AppPlatform;
  resourceClass: EasBuildBillingResourceClass;
  count: number;
  costCents: number;
}

export interface UsageDisplayData {
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

export function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatCurrency(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function formatNumber(value: number, decimals: number = 0): string {
  if (decimals === 0) {
    return Math.round(value).toLocaleString();
  }
  return value.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function calculateDaysRemaining(endDate: string): number {
  const end = new Date(endDate);
  const now = new Date();
  const diffTime = end.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
}

export function calculateDaysElapsed(startDate: string): number {
  const start = new Date(startDate);
  const now = new Date();
  const diffTime = now.getTime() - start.getTime();
  return Math.max(1, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
}

export function calculateBillingPeriodDays(startDate: string, endDate: string): number {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const diffTime = end.getTime() - start.getTime();
  return Math.max(1, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
}

export function extractUsageData(data: AccountFullUsageData): UsageDisplayData {
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

export function calculateBillingPeriodInfo(data: UsageDisplayData): {
  daysRemaining: number;
  daysElapsed: number;
  totalDays: number;
} {
  const daysElapsed = calculateDaysElapsed(data.billingPeriod.start);
  const totalDays = calculateBillingPeriodDays(data.billingPeriod.start, data.billingPeriod.end);
  const daysRemaining = calculateDaysRemaining(data.billingPeriod.end);

  return {
    daysRemaining,
    daysElapsed,
    totalDays,
  };
}
