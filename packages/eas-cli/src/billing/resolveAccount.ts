import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { Permission, Role } from '../graphql/generated';
import { AccountQuery } from '../graphql/queries/AccountQuery';
import { Actor } from '../user/User';
import { selectAsync } from '../prompts';

export type BillingAccount = { id: string; name: string };

type AccountWithViewerPermissions = BillingAccount & {
  viewerUserPermission: { permissions: Permission[] };
};

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
}: {
  graphqlClient: ExpoGraphqlClient;
  actor: Actor;
  accountName: string | undefined;
  nonInteractive: boolean;
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
      return found;
    }
    const account = await AccountQuery.getByNameAsync(graphqlClient, accountName).catch(() => null);
    if (!account) {
      throw new Error(
        `Account "${accountName}" not found or you don't have access. Available accounts: ${availableAccounts}`
      );
    }
    assertBillingPermission(account);
    return account;
  }

  if (billingAccounts.length === 0) {
    throw new Error('You must be an Owner or Admin of at least one account to manage billing.');
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
