import { Flags } from '@oclif/core';

import { BillingClient } from '../../billing/billingClient';
import { openOrPrintUrlAsync } from '../../billing/openUrl';
import { resolveBillingAccountAsync } from '../../billing/resolveAccount';
import EasCommand from '../../commandUtils/EasCommand';
import { EasNonInteractiveAndJsonFlags } from '../../commandUtils/flags';
import { ora } from '../../ora';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

export default class BillingManage extends EasCommand {
  static override description =
    'open the Stripe customer portal to manage billing (change plan, update payment method, or cancel)';

  static override flags = {
    account: Flags.string({
      char: 'a',
      description: 'Account to manage. Defaults to your account when you only have one.',
    }),
    open: Flags.boolean({
      allowNo: true,
      default: true,
      description: 'Open the customer portal in a browser (use --no-open to only print the URL)',
    }),
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(BillingManage);
    const nonInteractive = flags['non-interactive'];
    const json = flags.json || nonInteractive;
    if (json) {
      enableJsonOutput();
    }

    const {
      loggedIn: { graphqlClient, actor, authenticationInfo },
    } = await this.getContextAsync(BillingManage, { nonInteractive });

    const account = await resolveBillingAccountAsync({
      graphqlClient,
      actor,
      accountName: flags.account,
      nonInteractive,
    });

    const billingClient = new BillingClient(authenticationInfo);

    const spinner = ora(`Creating a customer portal session for ${account.name}`).start();
    let portalUrl: string;
    try {
      const { url } = await billingClient.createCustomerPortalSessionAsync(account.id);
      portalUrl = url;
      spinner.succeed(`Created a customer portal session for ${account.name}`);
    } catch (error) {
      spinner.fail('Failed to create a customer portal session');
      throw error;
    }

    if (json) {
      printJsonOnlyOutput({ customerPortalUrl: portalUrl });
      return;
    }

    await openOrPrintUrlAsync(portalUrl, {
      label: 'Customer portal',
      open: flags.open && !nonInteractive,
    });
  }
}
