import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { BillingUpdateQuery } from '../graphql/queries/BillingUpdateQuery';
import Log from '../log';
import { getOwnerAccountForProjectIdAsync } from '../project/projectUtils';

const WARNING_THRESHOLD = 0.85;
export async function maybeWarnAboutEasPlanOverageAsync(
  graphqlClient: ExpoGraphqlClient,
  projectId: string
): Promise<void> {
  const account = await getOwnerAccountForProjectIdAsync(graphqlClient, projectId);
  const billingUpdateQuery = await BillingUpdateQuery.byAccountIdAsync(
    graphqlClient,
    account.id,
    new Date()
  );

  const isFree = !billingUpdateQuery.billing; // TODO: no billing means free?
  const isMetered = !!billingUpdateQuery.billing?.subscription?.meteredBillingStatus?.EAS_UPDATE;
  // TODO: verify correctness
  if (!isFree || isMetered) {
    return;
  }

  const planMetrics = billingUpdateQuery.usageMetrics.byBillingPeriod.planMetrics;
  for (const metric of planMetrics) {
    const { value, limit, serviceMetric } = metric;
    const percentageUsed = value / limit;
    if (percentageUsed >= 1) {
      Log.error(
        'You have exceeded your EAS Update plan limit. You can create updates but they will no longer be distributed to users.'
      );
      Log.error('Please upgrade your plan to continue receiving updates.');
      return;
    } else if (percentageUsed >= WARNING_THRESHOLD && percentageUsed < 1) {
      Log.warn(
        `You are approaching your EAS Update plan limit. You have used ${Math.round(
          percentageUsed * 100
        )}% of your plan's ${serviceMetric}.`
      );
      Log.warn('Please upgrade your plan to continue receiving updates.');
    }
  }
}
