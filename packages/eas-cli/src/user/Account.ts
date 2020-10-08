export interface Account {
  id: string;
  name: string;
}

export function findAccountByName(accounts: Account[], needle: string): Account | undefined {
  return accounts.find(({ name }) => name === needle);
}
