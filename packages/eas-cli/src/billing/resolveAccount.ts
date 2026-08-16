import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { Permission, Role } from '../graphql/generated';
import { AccountQuery, type AccountSubscriptionInfo } from '../graphql/queries/AccountQuery';
import { hasPaidSubscription } from './plans';
import { Actor } from '../user/User';
import { ExpoChoice, selectAsync } from '../prompts';

export type BillingAccount = {
  id: string;
  name: string;
  subscription: AccountSubscriptionInfo | null;
};

type SubscriptionFilter = 'subscribed' | 'unsubscribed';

function billingPermissionError(accountName: string): Error {
  return new Error(`You must be an Owner or Admin of account "${accountName}" to manage billing.`);
}

function hasBillingRole(actor: Actor, account: Actor['accounts'][number]): boolean {
  if (account.ownerUserActor?.id === actor.id) {
    return true;
  }
  const role = account.users.find(user => user.actor.id === actor.id)?.role;
  return role === Role.Admin || role === Role.Owner || role === Role.HasAdmin;
}

async function getAccountWithSubscriptionAsync(
  graphqlClient: ExpoGraphqlClient,
  account: { id: string; name: string }
): Promise<BillingAccount> {
  const subscription = await AccountQuery.getSubscriptionAsync(graphqlClient, account.id);
  return { id: account.id, name: account.name, subscription };
}

function toAccountChoice(account: BillingAccount, disabled: boolean): ExpoChoice<BillingAccount> {
  const fallback = hasPaidSubscription(account.subscription) ? 'Paid' : 'Free';
  return {
    title: account.name,
    value: account,
    description: `Current plan: ${account.subscription?.name ?? fallback}`,
    disabled,
  };
}

async function resolveNamedAccountAsync(
  graphqlClient: ExpoGraphqlClient,
  actor: Actor,
  accountName: string
): Promise<{ id: string; name: string }> {
  const ownAccount = actor.accounts.find(account => account.name === accountName);
  if (ownAccount) {
    if (!hasBillingRole(actor, ownAccount)) {
      throw billingPermissionError(ownAccount.name);
    }
    return ownAccount;
  }

  const account = await AccountQuery.getByNameAsync(graphqlClient, accountName).catch(() => null);
  if (!account) {
    const availableAccounts = actor.accounts
      .filter(candidate => hasBillingRole(actor, candidate))
      .map(candidate => candidate.name)
      .join(', ');
    throw new Error(
      `Account "${accountName}" not found or you don't have access. Available accounts: ${availableAccounts}`
    );
  }

  const { permissions } = account.viewerUserPermission;
  if (!permissions.includes(Permission.Admin) && !permissions.includes(Permission.Own)) {
    throw billingPermissionError(account.name);
  }
  return account;
}

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
  subscriptionFilter: SubscriptionFilter;
}): Promise<BillingAccount> {
  if (accountName) {
    const namedAccount = await resolveNamedAccountAsync(graphqlClient, actor, accountName);
    const account = await getAccountWithSubscriptionAsync(graphqlClient, namedAccount);
    if (subscriptionFilter === 'subscribed' && !hasPaidSubscription(account.subscription)) {
      throw new Error(
        `Account "${account.name}" does not have an active paid plan. Run eas billing:subscribe to subscribe.`
      );
    }
    return account;
  }

  const billingAccounts = actor.accounts.filter(account => hasBillingRole(actor, account));
  if (billingAccounts.length === 0) {
    throw new Error('You must be an Owner or Admin of at least one account to manage billing.');
  }

  const accounts = await Promise.all(
    billingAccounts.map(account => getAccountWithSubscriptionAsync(graphqlClient, account))
  );
  if (subscriptionFilter === 'unsubscribed' && accounts.length === 1) {
    return accounts[0];
  }

  const subscribedAccounts = accounts.filter(account => hasPaidSubscription(account.subscription));
  const unsubscribedAccounts = accounts.filter(
    account => !hasPaidSubscription(account.subscription)
  );
  const eligibleAccounts =
    subscriptionFilter === 'subscribed' ? subscribedAccounts : unsubscribedAccounts;

  if (eligibleAccounts.length === 0) {
    throw new Error(
      subscriptionFilter === 'subscribed'
        ? 'No available accounts have an active paid plan. Run eas billing:subscribe to subscribe an account.'
        : 'All available accounts already have a paid plan. Run eas billing:manage to change an existing subscription.'
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

  const disabledAccounts = subscriptionFilter === 'unsubscribed' ? subscribedAccounts : [];
  return await selectAsync(
    'Select an account:',
    [
      ...eligibleAccounts.map(account => toAccountChoice(account, false)),
      ...disabledAccounts.map(account => toAccountChoice(account, true)),
    ],
    {
      initial: eligibleAccounts[0],
      warningMessageForDisabledEntries:
        'This account already has a paid plan. Run eas billing:manage to change it.',
    }
  );
}
