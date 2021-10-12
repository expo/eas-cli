import { ApiKey, ApiKeyType, UserRole } from '@expo/apple-utils';

import Log from '../../../log';
import { ora } from '../../../ora';
import { AscApiKey, AscApiKeyInfo } from './Credentials.types';
import { AuthCtx, getRequestContext } from './authenticate';

export async function listAscApiKeysAsync(authCtx: AuthCtx): Promise<AscApiKeyInfo[]> {
  const spinner = ora(`Fetching App Store Connect Api Keys`).start();
  try {
    const context = getRequestContext(authCtx);
    const keys = await ApiKey.getAsync(context);
    spinner.succeed(`Fetched App Store Connect Api Keys`);
    return keys.map(key => getAscApiKeyInfo(key, authCtx));
  } catch (error) {
    spinner.fail(`Failed to fetch App Store Connect Api Keys`);
    throw error;
  }
}

export async function getAscApiKeyAsync(authCtx: AuthCtx, keyId: string): Promise<AscApiKeyInfo> {
  const spinner = ora(`Fetching App Store Connect Api Key`).start();
  try {
    const context = getRequestContext(authCtx);
    const apiKey = await ApiKey.infoAsync(context, { id: keyId });
    spinner.succeed(`Fetched App Store Connect Api Key (ID: ${keyId})`);
    return getAscApiKeyInfo(apiKey, authCtx);
  } catch (error) {
    Log.error(error);
    spinner.fail(`Failed to fetch App Store Connect Api Key`);
    throw error;
  }
}

export async function createAscApiKeyAsync(
  authCtx: AuthCtx,
  {
    name,
    allAppsVisible,
    role,
    keyType,
  }: { name: string; allAppsVisible?: boolean; role?: UserRole; keyType?: ApiKeyType }
): Promise<AscApiKey> {
  const spinner = ora(`Creating App Store Connect Api Key`).start();
  try {
    const context = getRequestContext(authCtx);
    const key = await ApiKey.createAsync(context, {
      nickname: name,
      allAppsVisible: allAppsVisible ?? true,
      roles: [role ?? UserRole.ADMIN],
      keyType: keyType ?? ApiKeyType.PUBLIC_API,
    });
    const keyP8 = await key.downloadAsync();
    if (!keyP8) {
      throw new Error('Failed to download App Store Connect Api .p8 file');
    }
    return {
      ...getAscApiKeyInfo(key, authCtx),
      keyP8,
    };
  } catch (err: any) {
    spinner.fail('Failed to create App Store Connect Api Key');
    throw err;
  }
}

export async function revokeAscApiKeyAsync(
  authCtx: AuthCtx,
  keyId: string
): Promise<AscApiKeyInfo> {
  const spinner = ora(`Revoking App Store Connect Api Key`).start();
  try {
    const context = getRequestContext(authCtx);
    const apiKey = await ApiKey.infoAsync(context, { id: keyId });
    const revokedKey = await apiKey.revokeAsync();
    spinner.succeed(`Revoked App Store Connect Api Key`);
    return getAscApiKeyInfo(revokedKey, authCtx);
  } catch (error) {
    Log.error(error);
    spinner.fail(`Failed to revoke App Store Connect Api Key`);
    throw error;
  }
}

export function getAscApiKeyInfo(apiKey: ApiKey, authCtx: AuthCtx): AscApiKeyInfo {
  return {
    name: apiKey.attributes.nickname,
    keyId: apiKey.id,
    issuerId: apiKey.attributes.provider?.id,
    teamId: authCtx.team.id,
    teamName: authCtx.team.name,
    roles: apiKey.attributes.roles,
  };
}
