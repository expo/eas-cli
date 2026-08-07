import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { Permission, Role } from '../graphql/generated';
import { AccountQuery, type AccountSubscriptionInfo } from '../graphql/queries/AccountQuery';
import { hasPaidSubscription } from './plans';
import { Actor } from '../user/User';
import { selectAsync } from '../prompts';

export type BillingAccount = {
  id: string;
  name: string;
  subscription?: AccountSubscriptionInfo | null;
};

type AccountWithViewerPermissions = BillingAccount & {
  viewerUserPermission: { permissions: Permission[] };
};

type SubscriptionFilter = 'subscribed' | 'unsubscribed';

function hasBillingPermission(account: AccountWithViewerPermissions): boolean {
  const { permissions } = account.viewerUserPermission;
  return permissions.includes(Permission.Admin) || permissions.includes(Permission.Own);
}

function hasBillingRole(actor: Actor, account: Actor['accounts'][number]): boolean {
  if (account.ownerUserActor?.id === actor.id) {
    return true;
  }
  const role = account.users.find(user => user.actor.id === actor.id)?.role;
  return role === Role.Admin || role === Role.Owner || role === Role.HasAdmin;
}

function assertBillingPermission(account: AccountWithViewerPermissions): void {
  if (!hasBillingPermission(account)) {
    throw new Error(
      `You must be an Owner or Admin of account "${account.name}" to manage billing.`
    );
  }
}

async function getAccountWithSubscriptionAsync(
  graphqlClient: ExpoGraphqlClient,
  account: BillingAccount
): Promise<BillingAccount> {
  const subscription = await AccountQuery.getSubscriptionAsync(graphqlClient, account.id);
  return { id: account.id, name: account.name, subscription };
}

function assertAccountCanBeManaged(account: BillingAccount): void {
  if (!hasPaidSubscription(account.subscription ?? null)) {
    throw new Error(
      `Account "${account.name}" does not have an active paid plan. Run eas billing:subscribe to subscribe.`
    );
  }
}

/**
 * Resolves the account to operate on for a billing command. When `accountName` is provided we
 * prefer one of the actor's own accounts and fall back to a by-name lookup (e.g. organizations
 * the actor can administer). Otherwise we use the only account, or prompt when interactive.
 */
export async function resolveBillingAccountAsync({
  graphqlClient,
  actor,
  accountName,
  nonInteractive,
  subscriptionFilter,
}: {
  graphqlClient: ExpoGraphqlClient;
  actor: Actor;
  accountName: string | undefined;
  nonInteractive: boolean;
  subscriptionFilter?: SubscriptionFilter;
}): Promise<BillingAccount> {
  const billingAccounts = actor.accounts.filter(account => hasBillingRole(actor, account));
  const availableAccounts = billingAccounts.map(account => account.name).join(', ');

  if (accountName) {
    const found = actor.accounts.find(account => account.name === accountName);
    if (found) {
      if (!hasBillingRole(actor, found)) {
        throw new Error(
          `You must be an Owner or Admin of account "${found.name}" to manage billing.`
        );
      }
      if (!subscriptionFilter) {
        return found;
      }
      const account = await getAccountWithSubscriptionAsync(graphqlClient, found);
      if (subscriptionFilter === 'subscribed') {
        assertAccountCanBeManaged(account);
      }
      return account;
    }
    const account = await AccountQuery.getByNameAsync(graphqlClient, accountName).catch(() => null);
    if (!account) {
      throw new Error(
        `Account "${accountName}" not found or you don't have access. Available accounts: ${availableAccounts}`
      );
    }
    assertBillingPermission(account);
    if (!subscriptionFilter) {
      return account;
    }
    const accountWithSubscription = await getAccountWithSubscriptionAsync(graphqlClient, account);
    if (subscriptionFilter === 'subscribed') {
      assertAccountCanBeManaged(accountWithSubscription);
    }
    return accountWithSubscription;
  }

  if (billingAccounts.length === 0) {
    throw new Error('You must be an Owner or Admin of at least one account to manage billing.');
  }

  if (subscriptionFilter) {
    const accountsWithSubscriptions = await Promise.all(
      billingAccounts.map(account => getAccountWithSubscriptionAsync(graphqlClient, account))
    );
    const subscribedAccounts = accountsWithSubscriptions.filter(account =>
      hasPaidSubscription(account.subscription ?? null)
    );
    const unsubscribedAccounts = accountsWithSubscriptions.filter(
      account => !hasPaidSubscription(account.subscription ?? null)
    );
    const eligibleAccounts =
      subscriptionFilter === 'subscribed' ? subscribedAccounts : unsubscribedAccounts;

    if (eligibleAccounts.length === 0) {
      if (subscriptionFilter === 'subscribed') {
        throw new Error(
          'No available accounts have an active paid plan. Run eas billing:subscribe to subscribe an account.'
        );
      }
      throw new Error(
        'All available accounts already have a paid plan. Run eas billing:manage to change an existing subscription.'
      );
    }

    if (eligibleAccounts.length === 1) {
      return eligibleAccounts[0];
    }

    if (nonInteractive) {
      throw new Error(
        'The --account flag must be provided when running in `--non-interactive` mode and you can manage billing for more than one eligible account.'
      );
    }

    if (subscriptionFilter === 'subscribed') {
      return await selectAsync(
        'Select an account:',
        subscribedAccounts.map(account => ({
          title: account.name,
          value: account,
          description: `Current plan: ${account.subscription?.name ?? 'Paid'}`,
        })),
        { initial: subscribedAccounts[0] }
      );
    }

    const choices = [
      ...unsubscribedAccounts.map(account => ({
        title: account.name,
        value: account,
        description: `Current plan: ${account.subscription?.name ?? 'Free'}`,
        disabled: false,
      })),
      ...subscribedAccounts.map(account => ({
        title: account.name,
        value: account,
        description: `Current plan: ${account.subscription?.name ?? 'Paid'}`,
        disabled: true,
      })),
    ];

    return await selectAsync('Select an account:', choices, {
      initial: unsubscribedAccounts[0],
      warningMessageForDisabledEntries:
        'This account already has a paid plan. Run eas billing:manage to change it.',
    });
  }

  if (billingAccounts.length === 1) {
    return billingAccounts[0];
  }

  if (nonInteractive) {
    throw new Error(
      'The --account flag must be provided when running in `--non-interactive` mode and you can manage billing for more than one account.'
    );
  }

  return await selectAsync(
    'Select an account:',
    billingAccounts.map(account => ({ title: account.name, value: account })),
    { initial: billingAccounts[0] }
  );
}
