import { Args, Flags } from '@oclif/core';

import { BillingClient } from '../../billing/billingClient';
import { openOrPrintUrlAsync } from '../../billing/openUrl';
import { FREE_PLAN_PRICE_ID, PLAN_SLUGS, PlanSlug, SUBSCRIBABLE_PLANS } from '../../billing/plans';
import { resolveBillingAccountAsync } from '../../billing/resolveAccount';
import EasCommand from '../../commandUtils/EasCommand';
import { EasNonInteractiveAndJsonFlags } from '../../commandUtils/flags';
import { AccountQuery } from '../../graphql/queries/AccountQuery';
import Log from '../../log';
import { ora } from '../../ora';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

export default class BillingSubscribe extends EasCommand {
  static override description = 'subscribe an account to an EAS plan via Stripe checkout';

  static override args = {
    PLAN: Args.string({
      description: `plan to subscribe to (${PLAN_SLUGS.join(', ')})`,
      required: true,
      options: [...PLAN_SLUGS],
    }),
  };

  static override flags = {
    account: Flags.string({
      char: 'a',
      description: 'Account to subscribe. Defaults to your account when you only have one.',
    }),
    open: Flags.boolean({
      allowNo: true,
      default: true,
      description:
        'Open the Stripe checkout page in a browser (use --no-open to only print the URL)',
    }),
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const {
      args: { PLAN },
      flags,
    } = await this.parse(BillingSubscribe);
    const planSlug = PLAN as PlanSlug;
    const nonInteractive = flags['non-interactive'];
    const json = flags.json || nonInteractive;
    if (json) {
      enableJsonOutput();
    }

    const {
      loggedIn: { graphqlClient, actor, authenticationInfo },
    } = await this.getContextAsync(BillingSubscribe, { nonInteractive });

    const account = await resolveBillingAccountAsync({
      graphqlClient,
      actor,
      accountName: flags.account,
      nonInteractive,
    });

    const plan = SUBSCRIBABLE_PLANS[planSlug];

    const subscription = await AccountQuery.getSubscriptionAsync(graphqlClient, account.id);
    const hasPaidSubscription =
      subscription?.planId != null && subscription.planId !== FREE_PLAN_PRICE_ID;

    if (hasPaidSubscription) {
      // Creating a new checkout session for an account that already has a paid subscription would
      // create a second, parallel subscription. Route plan changes and cancellation through the
      // Stripe customer portal (`eas billing:manage`), which handles proration natively.
      if (json) {
        printJsonOnlyOutput({
          checkoutUrl: null,
          alreadySubscribed: true,
          currentPlan: subscription?.name ?? null,
        });
        return;
      }
      Log.warn(
        `Account ${account.name} is already subscribed${
          subscription?.name ? ` to the ${subscription.name} plan` : ''
        }.`
      );
      Log.log('To change or cancel your plan, run eas billing:manage.');
      return;
    }

    const billingClient = new BillingClient(authenticationInfo);

    const spinner = ora(`Creating a checkout session for the ${plan.label} plan`).start();
    let checkoutUrl: string;
    try {
      const session = await billingClient.createCheckoutSessionAsync(account.id, [plan.planType]);
      if (!session.url) {
        throw new Error('The checkout session did not include a URL.');
      }
      checkoutUrl = session.url;
      spinner.succeed(`Created a checkout session for the ${plan.label} plan`);
    } catch (error) {
      spinner.fail('Failed to create a checkout session');
      throw error;
    }

    if (json) {
      printJsonOnlyOutput({ checkoutUrl, alreadySubscribed: false, currentPlan: null });
      return;
    }

    Log.log(
      `Complete your subscription to the ${plan.label} plan for ${account.name} in Stripe checkout.`
    );
    await openOrPrintUrlAsync(checkoutUrl, {
      label: 'Checkout page',
      open: flags.open && !nonInteractive,
    });
  }
}
