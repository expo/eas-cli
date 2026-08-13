import { Flags } from '@oclif/core';

import { BillingClient } from '../../billing/billingClient';
import { openOrPrintUrlAsync } from '../../billing/openUrl';
import { resolveBillingAccountAsync } from '../../billing/resolveAccount';
import EasCommand from '../../commandUtils/EasCommand';
import {
  EasNonInteractiveAndJsonFlags,
  resolveNonInteractiveAndJsonFlags,
} from '../../commandUtils/flags';
import { ora } from '../../ora';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

export default class BillingManage extends EasCommand {
  static override description = 'manage billing for an account with an active paid EAS plan';

  static override flags = {
    account: Flags.string({
      char: 'a',
      description:
        'Account with an active paid plan to manage. Defaults to your account when only one is eligible.',
    }),
    'no-open': Flags.boolean({
      description: 'Only print the customer portal URL instead of opening it in a browser',
    }),
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(BillingManage);
    const { json, nonInteractive } = resolveNonInteractiveAndJsonFlags(flags);
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
      subscriptionFilter: 'subscribed',
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
      open: !flags['no-open'] && !nonInteractive,
    });
  }
}
