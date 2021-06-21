import { Context } from '../../context';
import { PushKey } from '../appstore/Credentials.types';
import { filterRevokedAndUntrackedPushKeys } from '../appstore/CredentialsUtils';

export async function isPushKeyValidAndTrackedAsync(ctx: Context, pushKey: PushKey) {
  const pushInfoFromApple = await ctx.appStore.listPushKeysAsync();
  const validPushKeys = await filterRevokedAndUntrackedPushKeys([pushKey], pushInfoFromApple);
  return validPushKeys.length > 0;
}
