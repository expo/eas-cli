import chalk from 'chalk';

import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { Permission } from '../graphql/generated';
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

type ViewerPermissions = {
  permissions: readonly Permission[];
  effectivePermissions: readonly Permission[];
};

function billingPermissionError(accountName: string): Error {
  return new Error(`You must be an Owner or Admin of account "${accountName}" to manage billing.`);
}

/**
 * @param accounts which accounts the viewer is an Owner or Admin of, e.g. `account "name"`
 */
function scopedCredentialBillingPermissionError(accounts: string): Error {
  return new Error(
    `You are an Owner or Admin of ${accounts}, but the permissions granted during authentication do not allow you to manage billing. Run ${chalk.bold(
      'eas whoami'
    )} to check your permission grant, and ${chalk.bold('eas login')} to change it.`
  );
}

function hasBillingPermission(permissions: readonly Permission[]): boolean {
  return permissions.includes(Permission.Admin) || permissions.includes(Permission.Own);
}

/**
 * Whether the viewer can manage billing on the account with the credential used for this command.
 * The scopes of a scoped credential cap `effectivePermissions`.
 */
export function canManageBilling(account: { viewerUserPermission2: ViewerPermissions }): boolean {
  return hasBillingPermission(account.viewerUserPermission2.effectivePermissions);
}

/**
 * Whether the viewer's role on the account allows billing, regardless of the scopes of the
 * credential used for this command.
 */
function hasBillingRole(account: { viewerUserPermission2: ViewerPermissions }): boolean {
  return hasBillingPermission(account.viewerUserPermission2.permissions);
}

function assertCanManageBilling(account: {
  name: string;
  viewerUserPermission2: ViewerPermissions;
}): void {
  if (canManageBilling(account)) {
    return;
  }
  throw hasBillingRole(account)
    ? scopedCredentialBillingPermissionError(`account "${account.name}"`)
    : billingPermissionError(account.name);
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
    assertCanManageBilling(ownAccount);
    return ownAccount;
  }

  const account = await AccountQuery.getByNameAsync(graphqlClient, accountName).catch(() => null);
  if (!account) {
    const availableAccounts = actor.accounts
      .filter(canManageBilling)
      .map(candidate => candidate.name)
      .join(', ');
    throw new Error(
      `Account "${accountName}" not found or you don't have access. Available accounts: ${availableAccounts}`
    );
  }

  assertCanManageBilling(account);
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

  const billingAccounts = actor.accounts.filter(canManageBilling);
  if (billingAccounts.length === 0) {
    if (actor.accounts.some(hasBillingRole)) {
      throw scopedCredentialBillingPermissionError('at least one account');
    }
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
