import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { AccountQuery } from '../graphql/queries/AccountQuery';
import { Actor } from '../user/User';
import { selectAsync } from '../prompts';

export type BillingAccount = { id: string; name: string };

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
  const availableAccounts = actor.accounts.map(account => account.name).join(', ');

  if (accountName) {
    const found = actor.accounts.find(account => account.name === accountName);
    if (found) {
      return found;
    }
    const account = await AccountQuery.getByNameAsync(graphqlClient, accountName).catch(() => null);
    if (!account) {
      throw new Error(
        `Account "${accountName}" not found or you don't have access. Available accounts: ${availableAccounts}`
      );
    }
    return account;
  }

  if (actor.accounts.length === 1) {
    return actor.accounts[0];
  }

  if (nonInteractive) {
    throw new Error(
      'The --account flag must be provided when running in `--non-interactive` mode and you have access to more than one account.'
    );
  }

  return await selectAsync(
    'Select an account:',
    actor.accounts.map(account => ({ title: account.name, value: account })),
    { initial: actor.accounts[0] }
  );
}
