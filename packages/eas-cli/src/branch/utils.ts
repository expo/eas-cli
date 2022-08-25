import { getVcsClient } from '../vcs';

export async function getDefaultBranchNameAsync(): Promise<string> {
  return (
    (await getVcsClient().getBranchNameAsync()) ||
    `branch-${Math.random().toString(36).substring(2, 4)}`
  );
}
