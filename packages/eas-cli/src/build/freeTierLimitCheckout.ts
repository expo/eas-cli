import { getExpoWebsiteBaseUrl } from '../api';
import { getAgentTelemetryContext } from '../analytics/agent';
import { Analytics, AnalyticsEventProperties, BuildEvent } from '../analytics/AnalyticsManager';
import { BillingClient } from '../billing/billingClient';
import { openOrPrintUrlAsync } from '../billing/openUrl';
import { SUBSCRIBABLE_PLANS } from '../billing/plans';
import { canManageBilling } from '../billing/resolveAccount';
import { LazyExperimentationClient } from '../experimentation/LazyExperimentationClient';
import Log, { link } from '../log';
import { ora } from '../ora';
import { confirmAsync } from '../prompts';
import { LoggedInAuthenticationInfo } from '../user/SessionManager';
import { Actor } from '../user/User';

export const FREE_TIER_LIMIT_CHECKOUT_EXPERIMENT_NAMESPACE = 'cli-build-free-tier-limit-checkout';

export type FreeTierLimitCheckoutVariant = 'control' | 'treatment';

export type FreeTierLimitCheckoutPromptAnswer = 'yes' | 'no' | 'cancel';

export type FreeTierLimitCheckoutExperiment = {
  experimentation: LazyExperimentationClient;
  authenticationInfo: LoggedInAuthenticationInfo;
  analytics: Analytics;
  analyticsEventProperties: AnalyticsEventProperties;
  actor: Actor;
  accountId: string;
  accountName: string;
  nonInteractive: boolean;
  runFromCI: boolean;
};

const STARTER_PLAN = SUBSCRIBABLE_PLANS.starter;

export function getFreeTierLimitCheckoutExperiment(ctx: {
  experimentation?: LazyExperimentationClient;
  authenticationInfo?: LoggedInAuthenticationInfo;
  analytics: Analytics;
  analyticsEventProperties: AnalyticsEventProperties;
  user: Actor;
  accountId: string;
  accountName: string;
  nonInteractive: boolean;
  runFromCI: boolean;
}): FreeTierLimitCheckoutExperiment | undefined {
  if (!ctx.experimentation || !ctx.authenticationInfo) {
    return undefined;
  }
  return {
    experimentation: ctx.experimentation,
    authenticationInfo: ctx.authenticationInfo,
    analytics: ctx.analytics,
    analyticsEventProperties: ctx.analyticsEventProperties,
    actor: ctx.user,
    accountId: ctx.accountId,
    accountName: ctx.accountName,
    nonInteractive: ctx.nonInteractive,
    runFromCI: ctx.runFromCI,
  };
}

/**
 * Only a person at an interactive terminal who can manage billing for the account is eligible.
 * Non-interactive runs, CI, coding agents, and credentials that cannot manage billing are not.
 */
export function isEligibleForFreeTierLimitCheckout({
  actor,
  accountId,
  nonInteractive,
  runFromCI,
}: FreeTierLimitCheckoutExperiment): boolean {
  if (nonInteractive || runFromCI || getAgentTelemetryContext()) {
    return false;
  }
  const account = actor.accounts.find(candidate => candidate.id === accountId);
  return account !== undefined && canManageBilling(account);
}

export async function resolveFreeTierLimitCheckoutVariantAsync(
  experiment: FreeTierLimitCheckoutExperiment
): Promise<FreeTierLimitCheckoutVariant> {
  if (!isEligibleForFreeTierLimitCheckout(experiment)) {
    return 'control';
  }
  const client = await experiment.experimentation.getClientAsync();
  return client
    .getAccountNamespace(FREE_TIER_LIMIT_CHECKOUT_EXPERIMENT_NAMESPACE, {
      accountId: experiment.accountId,
    })
    .getParam<FreeTierLimitCheckoutVariant>('variant', 'control');
}

function formatAccountBillingUrl(accountName: string): string {
  return new URL(`/accounts/${accountName}/settings/billing`, getExpoWebsiteBaseUrl()).toString();
}

async function createCheckoutUrlAsync({
  authenticationInfo,
  accountId,
}: FreeTierLimitCheckoutExperiment): Promise<string | null> {
  const spinner = ora(`Creating a checkout session for the ${STARTER_PLAN.label} plan`).start();
  try {
    const session = await new BillingClient(authenticationInfo).createCheckoutSessionAsync(
      accountId,
      STARTER_PLAN.planType
    );
    if (!session.url) {
      throw new Error('The checkout session did not include a URL.');
    }
    spinner.stop();
    return session.url;
  } catch (error) {
    spinner.fail('Failed to create a checkout session');
    Log.debug(error);
    return null;
  }
}

/**
 * In the treatment arm, prints the limit error and offers to open the Starter plan checkout.
 */
export async function maybeOfferFreeTierLimitCheckoutAsync(
  message: string,
  experiment: FreeTierLimitCheckoutExperiment | undefined
): Promise<boolean> {
  if (!experiment || (await resolveFreeTierLimitCheckoutVariantAsync(experiment)) !== 'treatment') {
    return false;
  }

  Log.error(message);
  // Ctrl+C resolves to no answer instead of exiting, so the build error below still reports.
  const confirmed: boolean | undefined = await confirmAsync(
    {
      message: `Open the ${STARTER_PLAN.label} plan checkout in your browser now?`,
      initial: false,
    },
    { onCancel: () => false }
  );
  const answer: FreeTierLimitCheckoutPromptAnswer =
    confirmed === true ? 'yes' : confirmed === false ? 'no' : 'cancel';

  let checkoutCreated = false;
  if (answer === 'yes') {
    const checkoutUrl = await createCheckoutUrlAsync(experiment);
    if (checkoutUrl) {
      checkoutCreated = true;
      await openOrPrintUrlAsync(checkoutUrl, { label: 'Checkout page', open: true });
    } else {
      Log.log(`Upgrade your plan at ${link(formatAccountBillingUrl(experiment.accountName))}`);
    }
  }

  experiment.analytics.logEvent(BuildEvent.FREE_TIER_LIMIT_CHECKOUT_PROMPT, {
    ...experiment.analyticsEventProperties,
    answer,
    checkout_created: checkoutCreated,
  });
  return true;
}
