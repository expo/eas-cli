import { Client } from '../vcs/vcs';

export async function getDefaultBranchNameAsync(vcsClient: Client): Promise<string | null> {
  return await vcsClient.getBranchNameAsync();
}

export class BranchNotFoundError extends Error {
  constructor(message?: string) {
    super(message ?? 'Branch not found.');
  }
}
