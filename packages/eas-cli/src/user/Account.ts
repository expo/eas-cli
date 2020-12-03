import { Account as GraphQLAccount } from '../graphql/generated';

export type Account = Pick<GraphQLAccount, 'id' | 'name'>;

export function findAccountByName(
  accounts: (Account | null)[],
  needle: string
): Account | undefined {
  return accounts.find(account => account?.name === needle)!;
}
