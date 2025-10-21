import { PlanType, displayOverageWarning } from './displayOverageWarning';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { EasService, EasServiceMetric } from '../../graphql/generated';
import { AccountUsageQuery } from '../../graphql/queries/AccountUsageQuery';
import Log from '../../log';

function getPlanType(subscriptionName: string | undefined | null): PlanType | null {
  if (!subscriptionName) {
    return null;
  }
  const lowerName = subscriptionName.toLowerCase();
  if (lowerName === 'free') {
    return PlanType.Free;
  }
  if (lowerName === 'starter') {
    return PlanType.Starter;
  }
  return null;
}

const THRESHOLD_PERCENT = 85;

export async function maybeWarnAboutUsageOveragesAsync({
  graphqlClient,
  accountId,
  service,
}: {
  graphqlClient: ExpoGraphqlClient;
  accountId: string;
  service: EasService;
}): Promise<void> {
  try {
    const currentDate = new Date();
    const {
      name,
      subscription,
      usageMetrics: { EAS_BUILD, EAS_UPDATE },
    } = await AccountUsageQuery.getUsageForOverageWarningAsync(
      graphqlClient,
      accountId,
      currentDate
    );

    const planType = getPlanType(subscription?.name);
    if (!planType) {
      return;
    }

    let planMetric;
    if (service === EasService.Builds) {
      planMetric = EAS_BUILD?.planMetrics?.[0];
    } else if (service === EasService.Updates) {
      planMetric = EAS_UPDATE?.planMetrics?.find(
        metric => metric.serviceMetric === EasServiceMetric.UniqueUpdaters
      );
    }

    if (!planMetric) {
      return;
    }

    const percentUsed = calculatePercentUsed(planMetric.value, planMetric.limit);
    if (percentUsed >= THRESHOLD_PERCENT) {
      const printedMetric = service === EasService.Builds ? 'build credits' : 'updates MAU';
      displayOverageWarning({ percentUsed, printedMetric, planType, name });
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
