import { CredentialsContext } from '../../context';
import { MinimalAscApiKey } from '../credentials';

export async function isAscApiKeyValidAndTrackedAsync(
  ctx: CredentialsContext,
  ascApiKey: MinimalAscApiKey
): Promise<boolean> {
  const ascApiKeyInfo = await ctx.appStore.getAscApiKeyAsync(ascApiKey.keyId);
  if (!ascApiKeyInfo) {
    return false;
  }
  return !ascApiKeyInfo.isRevoked;
}
