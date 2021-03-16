import { Account as GraphQLAccount } from '../graphql/generated';

export type Account = Pick<GraphQLAccount, 'id' | 'name'>;

export function findAccountByName(accounts: Account[], needle: string): Account | undefined {
  return accounts.find(({ name }) => name === needle);
}
