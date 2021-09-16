import { Context } from '../../context';
import { PushKey } from '../appstore/Credentials.types';
import { filterRevokedAndUntrackedPushKeysAsync } from '../appstore/CredentialsUtils';

export async function isPushKeyValidAndTrackedAsync(
  ctx: Context,
  pushKey: PushKey
): Promise<boolean> {
  const pushInfoFromApple = await ctx.appStore.listPushKeysAsync();
  const validPushKeys = await filterRevokedAndUntrackedPushKeysAsync([pushKey], pushInfoFromApple);
  return validPushKeys.length > 0;
}
