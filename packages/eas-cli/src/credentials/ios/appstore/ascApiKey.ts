import { ApiKey, ApiKeyProps, ApiKeyType, UserRole } from '@expo/apple-utils';

import Log from '../../../log';
import { ora } from '../../../ora';
import { AscApiKey, AscApiKeyInfo } from './Credentials.types';
import { AuthCtx, getRequestContext } from './authenticate';

export async function listAscApiKeysAsync(authCtx: AuthCtx): Promise<AscApiKeyInfo[]> {
  const spinner = ora(`Fetching App Store Connect API Keys.`).start();
  try {
    const context = getRequestContext(authCtx);
    const keys = await ApiKey.getAsync(context);
    spinner.succeed(`Fetched App Store Connect API Keys.`);
    return keys.map(key => getAscApiKeyInfo(key, authCtx));
  } catch (error) {
    spinner.fail(`Failed to fetch App Store Connect API Keys.`);
    throw error;
  }
}

export async function getAscApiKeyAsync(
  authCtx: AuthCtx,
  keyId: string
): Promise<AscApiKeyInfo | null> {
  const spinner = ora(`Fetching App Store Connect API Key.`).start();
  try {
    const context = getRequestContext(authCtx);
    const apiKey = await ApiKey.infoAsync(context, { id: keyId });
    spinner.succeed(`Fetched App Store Connect API Key (ID: ${keyId}).`);
    return getAscApiKeyInfo(apiKey, authCtx);
  } catch (error: any) {
    const message = error?.message ?? '';
    if (message.includes("There is no resource of type 'apiKeys' with id")) {
      spinner.stop();
      return null;
    }
    Log.error(error);
    spinner.fail(`Failed to fetch App Store Connect API Key.`);
    throw error;
  }
}

export async function createAscApiKeyAsync(
  authCtx: AuthCtx,
  {
    nickname,
    allAppsVisible,
    roles,
    keyType,
  }: Partial<Pick<ApiKeyProps, 'nickname' | 'roles' | 'allAppsVisible' | 'keyType'>>
): Promise<AscApiKey> {
  const spinner = ora(`Creating App Store Connect API Key.`).start();
  try {
    const context = getRequestContext(authCtx);
    const key = await ApiKey.createAsync(context, {
      nickname: nickname ?? `[expo] ${new Date().getTime()}`,
      allAppsVisible: allAppsVisible ?? true,
      roles: roles ?? [UserRole.ADMIN],
      keyType: keyType ?? ApiKeyType.PUBLIC_API,
    });
    const keyP8 = await key.downloadAsync();
    if (!keyP8) {
      const { nickname, roles } = key.attributes;
      const humanReadableKey = `App Store Connect Key '${nickname}' (${
        key.id
      }) with roles {${roles.join(',')}}`;
      if (!key.attributes.canDownload) {
        // this case would be unexpected because we just created the key
        throw new Error(`${humanReadableKey} is not available for download from Apple.`);
      } else if (!key.attributes.isActive) {
        throw new Error(`${humanReadableKey} is inactive and could not be downloaded.`);
      }
      throw new Error(`Failed to download .p8 file of ${humanReadableKey}.`);
    }
    // this object has more optional parameters populated
    const fullKey = await ApiKey.infoAsync(context, { id: key.id });
    spinner.succeed(`Created App Store Connect API Key.`);
    return {
      ...getAscApiKeyInfo(fullKey, authCtx),
      keyP8,
    };
  } catch (err: any) {
    spinner.fail('Failed to create App Store Connect API Key.');
    throw err;
  }
}

export async function revokeAscApiKeyAsync(
  authCtx: AuthCtx,
  keyId: string
): Promise<AscApiKeyInfo> {
  const spinner = ora(`Revoking App Store Connect API Key.`).start();
  try {
    const context = getRequestContext(authCtx);
    const apiKey = await ApiKey.infoAsync(context, { id: keyId });
    const revokedKey = await apiKey.revokeAsync();
    spinner.succeed(`Revoked App Store Connect API Key.`);
    return getAscApiKeyInfo(revokedKey, authCtx);
  } catch (error) {
    Log.error(error);
    spinner.fail(`Failed to revoke App Store Connect API Key.`);
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
    isRevoked: !!apiKey.attributes.revokingDate,
  };
}
