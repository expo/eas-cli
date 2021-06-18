import { Context } from '../../context';
import { PushKey } from '../appstore/Credentials.types';
import { filterRevokedPushKeys } from '../appstore/CredentialsUtils';

export async function validatePushKeyAsync(ctx: Context, pushKey: PushKey) {
  const pushInfoFromApple = await ctx.appStore.listPushKeysAsync();
  const validPushKeys = await filterRevokedPushKeys([pushKey], pushInfoFromApple);
  return validPushKeys.length > 0;
}
