import { ApiKey, ApiKeyProps, ApiKeyType, UserRole } from '@expo/apple-utils';
import promiseRetry from 'promise-retry';

import { Analytics, SubmissionEvent } from '../../../analytics/events';
import Log, { learnMore } from '../../../log';
import { ora } from '../../../ora';
import { AscApiKey, AscApiKeyInfo } from './Credentials.types';
import { getRequestContext } from './authenticate';
import { AuthCtx, UserAuthCtx } from './authenticateTypes';

/**
 * List App Store Connect API Keys.
 * **Does not support App Store Connect API (CI).**
 */
export async function listAscApiKeysAsync(userAuthCtx: UserAuthCtx): Promise<AscApiKeyInfo[]> {
  const spinner = ora(`Fetching App Store Connect API Keys.`).start();
  try {
    const context = getRequestContext(userAuthCtx);
    const keys = await ApiKey.getAsync(context);
    spinner.succeed(`Fetched App Store Connect API Keys.`);
    return keys.map(key => getAscApiKeyInfo(key, userAuthCtx));
  } catch (error) {
    spinner.fail(`Failed to fetch App Store Connect API Keys.`);
    throw error;
  }
}

/**
 * Get an App Store Connect API Key.
 * **Does not support App Store Connect API (CI).**
 */
export async function getAscApiKeyAsync(
  userAuthCtx: UserAuthCtx,
  keyId: string
): Promise<AscApiKeyInfo | null> {
  const spinner = ora(`Fetching App Store Connect API Key.`).start();
  try {
    const context = getRequestContext(userAuthCtx);
    const apiKey = await ApiKey.infoAsync(context, { id: keyId });
    spinner.succeed(`Fetched App Store Connect API Key (ID: ${keyId}).`);
    return getAscApiKeyInfo(apiKey, userAuthCtx);
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

export async function downloadWithRetryAsync(
  key: ApiKey,
  options: { minTimeout?: number } = {}
): Promise<string | null> {
  const retries = 6;
  const factor = 2;
  const minTimeout = options.minTimeout ?? 1000;
  const RESOURCE_DOES_NOT_EXIST_MESSAGE =
    'The specified resource does not exist - There is no resource of type';
  try {
    return await promiseRetry(
      async (retry, number) => {
        try {
          return await key.downloadAsync();
        } catch (e: any) {
          if (
            e.name === 'UnexpectedAppleResponse' &&
            e.message.includes(RESOURCE_DOES_NOT_EXIST_MESSAGE)
          ) {
            const secondsToRetry = Math.pow(factor, number);
            Log.log(
              `Received an unexpected response from Apple, retrying in ${secondsToRetry} seconds...`
            );
            Analytics.logEvent(SubmissionEvent.CREDENTIALS_API_KEY_DOWNLOAD, {
              errorName: e.name,
              reason: e.message,
              retry: number,
            });
            return retry(e);
          }
          throw e;
        }
      },
      {
        retries,
        factor,
        minTimeout,
      }
    );
  } catch (e: any) {
    if (
      e.name === 'UnexpectedAppleResponse' &&
      e.message.includes(RESOURCE_DOES_NOT_EXIST_MESSAGE)
    ) {
      Log.warn(
        `Unable to download Api Key from Apple at this time. Please create and upload your key manually by running 'eas credentials' ${learnMore(
          'https://expo.fyi/creating-asc-api-key'
        )}`
      );
    }
    Analytics.logEvent(SubmissionEvent.CREDENTIALS_API_KEY_DOWNLOAD, {
      errorName: e.name,
      reason: e.message,
    });
    throw e;
  }
}

/**
 * Create an App Store Connect API Key.
 * **Does not support App Store Connect API (CI).**
 */
export async function createAscApiKeyAsync(
  userAuthCtx: UserAuthCtx,
  {
    nickname,
    allAppsVisible,
    roles,
    keyType,
  }: Partial<Pick<ApiKeyProps, 'nickname' | 'roles' | 'allAppsVisible' | 'keyType'>>
): Promise<AscApiKey> {
  const spinner = ora(`Creating App Store Connect API Key.`).start();
  try {
    const context = getRequestContext(userAuthCtx);
    const key = await ApiKey.createAsync(context, {
      nickname: nickname ?? `[expo] ${new Date().getTime()}`,
      allAppsVisible: allAppsVisible ?? true,
      roles: roles ?? [UserRole.ADMIN],
      keyType: keyType ?? ApiKeyType.PUBLIC_API,
    });
    const keyP8 = await downloadWithRetryAsync(key);
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
      ...getAscApiKeyInfo(fullKey, userAuthCtx),
      keyP8,
    };
  } catch (err: any) {
    spinner.fail('Failed to create App Store Connect API Key.');
    throw err;
  }
}

/**
 * Revoke an App Store Connect API Key.
 * **Does not support App Store Connect API (CI).**
 */
export async function revokeAscApiKeyAsync(
  userAuthCtx: UserAuthCtx,
  keyId: string
): Promise<AscApiKeyInfo> {
  const spinner = ora(`Revoking App Store Connect API Key.`).start();
  try {
    const context = getRequestContext(userAuthCtx);
    const apiKey = await ApiKey.infoAsync(context, { id: keyId });
    const revokedKey = await apiKey.revokeAsync();
    spinner.succeed(`Revoked App Store Connect API Key.`);
    return getAscApiKeyInfo(revokedKey, userAuthCtx);
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
