import { Account as GraphQLAccount } from '../graphql/generated';

export type Account = Pick<GraphQLAccount, 'id' | 'name'>;

export function findAccountByName(accounts: Account[], needle: string): Account | undefined {
  return accounts.find(({ name }) => name === needle);
}

/**
 * @todo Remove once the server has strict `[Account!]!` typing
 */
export function ensureAccounts(accounts?: (Account | null)[] | null): Account[] {
  return (accounts || []).filter(account => account) as Account[];
}
