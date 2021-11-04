import { AppStoreConnectApiKeyFragment } from '../../../graphql/generated';
import { CredentialsContext } from '../../context';
import { AscApiKeyInfo } from '../appstore/Credentials.types';
import { MinimalAscApiKey } from '../credentials';

export async function isAscApiKeyValidAndTrackedAsync(
  ctx: CredentialsContext,
  ascApiKey: MinimalAscApiKey
): Promise<boolean> {
  const ascApiKeyInfo = await ctx.appStore.getAscApiKeyAsync(ascApiKey.keyId);
  return isKeyValid(ascApiKeyInfo);
}

export async function getValidAndTrackedAscApiKeysAsync(
  ctx: CredentialsContext,
  ascApiKeys: AppStoreConnectApiKeyFragment[]
): Promise<AppStoreConnectApiKeyFragment[]> {
  const ascApiKeysInfo = await ctx.appStore.listAscApiKeysAsync();
  const validAscApiKeysInfo = ascApiKeysInfo.filter(keyInfo => isKeyValid(keyInfo));
  const validKeyIdentifiers = new Set(validAscApiKeysInfo.map(keyInfo => keyInfo.keyId));
  return ascApiKeys.filter(key => validKeyIdentifiers.has(key.keyIdentifier));
}

function isKeyValid(ascApiKeyInfo: AscApiKeyInfo | null): boolean {
  if (!ascApiKeyInfo) {
    return false;
  }
  return !ascApiKeyInfo.isRevoked;
}
