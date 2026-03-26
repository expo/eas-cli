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
  planValue: number;
  limit: number;
  percentUsed: number;
  overageValue: number;
  overageCost: number;
  unit?: string;
}

export interface BuildOverageByWorkerSize {
  platform: AppPlatform;
  resourceClass: EasBuildBillingResourceClass;
  count: number;
  costCents: number;
}

export interface BuildCountByPlatformAndSize {
  platform: 'ios' | 'android';
  resourceClass: 'medium' | 'large';
  count: number;
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
    countsByPlatformAndSize: BuildCountByPlatformAndSize[];
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
  const {
    EAS_BUILD,
    EAS_UPDATE,
    MEDIUM_ANDROID_BUILDS,
    LARGE_ANDROID_BUILDS,
    MEDIUM_IOS_BUILDS,
    LARGE_IOS_BUILDS,
  } = usageMetrics;

  // Find build metrics
  const buildMetric = EAS_BUILD.planMetrics.find(
    m => m.serviceMetric === EasServiceMetric.Builds && m.metricType === UsageMetricType.Build
  );

  // Extract build counts by platform and worker size
  const countsByPlatformAndSize: BuildCountByPlatformAndSize[] = [];
  const mediumAndroidCount = MEDIUM_ANDROID_BUILDS?.[0]?.value ?? 0;
  const largeAndroidCount = LARGE_ANDROID_BUILDS?.[0]?.value ?? 0;
  const mediumIosCount = MEDIUM_IOS_BUILDS?.[0]?.value ?? 0;
  const largeIosCount = LARGE_IOS_BUILDS?.[0]?.value ?? 0;

  if (mediumAndroidCount > 0) {
    countsByPlatformAndSize.push({
      platform: 'android',
      resourceClass: 'medium',
      count: mediumAndroidCount,
    });
  }
  if (largeAndroidCount > 0) {
    countsByPlatformAndSize.push({
      platform: 'android',
      resourceClass: 'large',
      count: largeAndroidCount,
    });
  }
  if (mediumIosCount > 0) {
    countsByPlatformAndSize.push({
      platform: 'ios',
      resourceClass: 'medium',
      count: mediumIosCount,
    });
  }
  if (largeIosCount > 0) {
    countsByPlatformAndSize.push({ platform: 'ios', resourceClass: 'large', count: largeIosCount });
  }

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
    m =>
      m.serviceMetric === EasServiceMetric.UniqueUpdaters && m.metricType === UsageMetricType.Update
  );
  const bandwidthMetric = EAS_UPDATE.planMetrics.find(
    m =>
      m.serviceMetric === EasServiceMetric.BandwidthUsage &&
      m.metricType === UsageMetricType.Bandwidth
  );
  const mauOverage = EAS_UPDATE.overageMetrics.find(
    m =>
      m.serviceMetric === EasServiceMetric.UniqueUpdaters && m.metricType === UsageMetricType.Update
  );
  const bandwidthOverage = EAS_UPDATE.overageMetrics.find(
    m =>
      m.serviceMetric === EasServiceMetric.BandwidthUsage &&
      m.metricType === UsageMetricType.Bandwidth
  );

  // Build metrics - plan values from planMetrics, overage from overageMetrics
  const buildPlanValue = buildMetric?.value ?? 0;
  const buildLimit = buildMetric?.limit ?? 0;
  const iosBuildPlanValue = buildMetric?.platformBreakdown?.ios.value ?? 0;
  const iosBuildLimit = buildMetric?.platformBreakdown?.ios.limit ?? 0;
  const androidBuildPlanValue = buildMetric?.platformBreakdown?.android.value ?? 0;
  const androidBuildLimit = buildMetric?.platformBreakdown?.android.limit ?? 0;

  // Update metrics - plan values from planMetrics, overage from overageMetrics
  const mauPlanValue = mauMetric?.value ?? 0;
  const mauOverageValue = mauOverage?.value ?? 0;
  const mauLimit = mauMetric?.limit ?? 0;

  const bandwidthPlanValue = bandwidthMetric?.value ?? 0;
  const bandwidthOverageValue = bandwidthOverage?.value ?? 0;
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
        planValue: buildPlanValue,
        limit: buildLimit,
        percentUsed: calculatePercentUsed(buildPlanValue, buildLimit),
        overageValue: totalOverageBuilds,
        overageCost: buildOverageCostCents,
        unit: 'builds',
      },
      ios: buildMetric?.platformBreakdown
        ? {
            name: 'iOS Builds',
            planValue: iosBuildPlanValue,
            limit: iosBuildLimit,
            percentUsed: calculatePercentUsed(iosBuildPlanValue, iosBuildLimit),
            overageValue: 0,
            overageCost: 0,
            unit: 'builds',
          }
        : undefined,
      android: buildMetric?.platformBreakdown
        ? {
            name: 'Android Builds',
            planValue: androidBuildPlanValue,
            limit: androidBuildLimit,
            percentUsed: calculatePercentUsed(androidBuildPlanValue, androidBuildLimit),
            overageValue: 0,
            overageCost: 0,
            unit: 'builds',
          }
        : undefined,
      countsByPlatformAndSize,
      overagesByWorkerSize,
      overageCostCents: buildOverageCostCents,
    },
    updates: {
      mau: {
        name: 'Unique Updaters',
        planValue: mauPlanValue,
        limit: mauLimit,
        percentUsed: calculatePercentUsed(mauPlanValue, mauLimit),
        overageValue: mauOverageValue,
        overageCost: mauOverage?.totalCost ?? 0,
        unit: 'users',
      },
      bandwidth: {
        name: 'Bandwidth',
        planValue: bandwidthPlanValue,
        limit: bandwidthLimit,
        percentUsed: calculatePercentUsed(bandwidthPlanValue, bandwidthLimit),
        overageValue: bandwidthOverageValue,
        overageCost: bandwidthOverage?.totalCost ?? 0,
        unit: 'bytes',
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
