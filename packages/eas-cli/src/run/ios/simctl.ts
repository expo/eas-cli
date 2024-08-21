import { SpawnOptions, SpawnResult } from '@expo/spawn-async';

import { xcrunAsync } from './xcrun';

export async function simctlAsync(args: string[], options?: SpawnOptions): Promise<SpawnResult> {
  return await xcrunAsync(['simctl', ...args], options);
}
