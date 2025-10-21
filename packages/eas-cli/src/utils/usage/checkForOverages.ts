import { calculateBuildThresholds, calculateUpdatesThresholds } from './calculateOverages';
import { PlanType, displayOverageWarningWithProgressBar } from './displayOverageWarning';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { EasService } from '../../graphql/generated';
import { AccountUsageQuery } from '../../graphql/queries/AccountUsageQuery';
import Log from '../../log';

/**
 * Checks if the account is on a free or starter plan based on the subscription name
 */
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

/**
 * Checks for usage overages and displays warnings if applicable.
 * Should be called when running builds or updates.
 */
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
    const accountData = await AccountUsageQuery.getUsageForOverageWarningAsync(
      graphqlClient,
      accountId,
      currentDate
    );

    const planType = getPlanType(accountData.subscription?.name);

    // Only show warnings for Free and Starter plans
    if (!planType) {
      return;
    }

    let threshold = null;

    if (service === EasService.Builds) {
      const buildMetrics = accountData.usageMetrics.EAS_BUILD;
      if (buildMetrics?.planMetrics && buildMetrics.planMetrics.length > 0) {
        threshold = calculateBuildThresholds({ planMetrics: buildMetrics.planMetrics });
      }
    } else if (service === EasService.Updates) {
      const updateMetrics = accountData.usageMetrics.EAS_UPDATE;
      if (updateMetrics?.planMetrics && updateMetrics.planMetrics.length > 0) {
        threshold = calculateUpdatesThresholds({ planMetrics: updateMetrics.planMetrics });
      }
    }

    if (threshold) {
      displayOverageWarningWithProgressBar(threshold, planType, accountData.name);
    }
  } catch (error) {
    // Silently fail if we can't fetch usage data - we don't want to block the user's workflow
    Log.debug(`Failed to fetch usage data: ${error}`);
  }
}
