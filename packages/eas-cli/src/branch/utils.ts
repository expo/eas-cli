import { Client } from '../vcs/vcs';

export async function getDefaultBranchNameAsync(vcsClient: Client): Promise<string> {
  return (
    (await vcsClient.getBranchNameAsync()) || `branch-${Math.random().toString(36).substring(2, 4)}`
  );
}

export class BranchNotFoundError extends Error {
  constructor(message?: string) {
    super(message ?? 'Branch not found.');
  }
}
