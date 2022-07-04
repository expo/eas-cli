import { CredentialsContext } from '../../context.js';
import { PushKey } from '../appstore/Credentials.types.js';
import { filterRevokedAndUntrackedPushKeysAsync } from '../appstore/CredentialsUtils.js';

export async function isPushKeyValidAndTrackedAsync(
  ctx: CredentialsContext,
  pushKey: PushKey
): Promise<boolean> {
  const pushInfoFromApple = await ctx.appStore.listPushKeysAsync();
  const validPushKeys = await filterRevokedAndUntrackedPushKeysAsync([pushKey], pushInfoFromApple);
  return validPushKeys.length > 0;
}
