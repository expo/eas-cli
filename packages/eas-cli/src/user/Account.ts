import { Account as GraphQLAccount } from '../graphql/generated';

export type Account = Pick<GraphQLAccount, 'id' | 'name'>;

export function findAccountByName<T extends Account>(accounts: T[], needle: string): T | undefined {
  return accounts.find(({ name }) => name === needle);
}
