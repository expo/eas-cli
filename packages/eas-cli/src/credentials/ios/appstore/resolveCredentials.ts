import { Auth, JsonFileCache } from '@expo/apple-utils';
import chalk from 'chalk';
import * as fs from 'fs-extra';
import wrapAnsi from 'wrap-ansi';

import { AppleTeamType, Team } from './authenticateTypes';
import * as Keychain from './keychain';
import Log, { learnMore } from '../../../log';
import { promptAsync } from '../../../prompts';
import { MinimalAscApiKey } from '../credentials';

/**
 * Get the username and possibly the password from the environment variables or the supplied options.
 * Password is optional because it's only needed for authentication, but not for re-authentication.
 *
 * @param options
 */
export async function resolveUserCredentialsAsync(
  options: Partial<Auth.UserCredentials>
): Promise<Partial<Auth.UserCredentials>> {
  const credentials = getAppleIdFromEnvironmentOrOptions(options);

  if (!credentials.username) {
    credentials.username = await promptUsernameAsync();
  }

  return credentials;
}

export function hasAscEnvVars(): boolean {
  return (
    !!process.env.EXPO_ASC_API_KEY_PATH ||
    !!process.env.EXPO_ASC_KEY_ID ||
    !!process.env.EXPO_ASC_ISSUER_ID
  );
}

export async function resolveAscApiKeyAsync(
  ascApiKey?: MinimalAscApiKey
): Promise<MinimalAscApiKey> {
  const passedKeyP8 = await getAscKeyP8FromEnvironmentOrOptionsAsync(ascApiKey);
  const passedKeyId = await getAscKeyIdFromEnvironmentOrOptionsAsync(ascApiKey);
  const passedIssuerId = await getAscIssuerIdFromEnvironmentOrOptionsAsync(ascApiKey);

  return {
    keyP8: passedKeyP8,
    keyId: passedKeyId,
    issuerId: passedIssuerId,
  };
}

async function getAscKeyP8FromEnvironmentOrOptionsAsync(
  ascApiKey?: MinimalAscApiKey
): Promise<string> {
  if (ascApiKey?.keyP8) {
    return ascApiKey?.keyP8;
  } else if (process.env.EXPO_ASC_API_KEY_PATH) {
    return await fs.readFile(process.env.EXPO_ASC_API_KEY_PATH, 'utf-8');
  }

  const { ascApiKeyPath } = await promptAsync({
    type: 'text',
    name: 'ascApiKeyPath',
    message: `Path to ASC Api Key Path (.p8):`,
    validate: (val: string) => val !== '',
  });
  return await fs.readFile(ascApiKeyPath, 'utf-8');
}

async function getAscKeyIdFromEnvironmentOrOptionsAsync(
  ascApiKey?: MinimalAscApiKey
): Promise<string> {
  if (ascApiKey?.keyId) {
    return ascApiKey?.keyId;
  } else if (process.env.EXPO_ASC_KEY_ID) {
    return process.env.EXPO_ASC_KEY_ID;
  }

  const { ascApiKeyId } = await promptAsync({
    type: 'text',
    name: 'ascApiKeyId',
    message: `ASC Api Key ID:`,
    validate: (val: string) => val !== '',
  });
  return ascApiKeyId;
}

async function getAscIssuerIdFromEnvironmentOrOptionsAsync(
  ascApiKey?: MinimalAscApiKey
): Promise<string> {
  if (ascApiKey?.issuerId) {
    return ascApiKey?.issuerId;
  } else if (process.env.EXPO_ASC_ISSUER_ID) {
    return process.env.EXPO_ASC_ISSUER_ID;
  }

  const { ascIssuerId } = await promptAsync({
    type: 'text',
    name: 'ascIssuerId',
    message: `ASC Issuer ID:`,
    validate: (val: string) => val !== '',
  });
  return ascIssuerId;
}

function isAppleTeamType(maybeTeamType: any): maybeTeamType is AppleTeamType {
  return maybeTeamType in AppleTeamType;
}

function assertAppleTeamType(maybeTeamType: any): AppleTeamType {
  if (!isAppleTeamType(maybeTeamType)) {
    throw new Error(
      `Invalid Apple Team Type: ${maybeTeamType}. Must be one of ${Object.keys(AppleTeamType).join(
        ', '
      )}`
    );
  }
  return maybeTeamType;
}

function resolveAppleTeamTypeFromEnvironment(): AppleTeamType | undefined {
  if (!process.env.EXPO_APPLE_TEAM_TYPE) {
    return undefined;
  }
  return assertAppleTeamType(process.env.EXPO_APPLE_TEAM_TYPE);
}

async function getAppleTeamIdFromEnvironmentOrOptionsAsync(options: {
  teamId?: string;
}): Promise<string> {
  if (options.teamId) {
    return options.teamId;
  } else if (process.env.EXPO_APPLE_TEAM_ID) {
    return process.env.EXPO_APPLE_TEAM_ID;
  }

  const { appleTeamId } = await promptAsync({
    type: 'text',
    name: 'appleTeamId',
    message: `Apple Team ID:`,
    validate: (val: string) => val !== '',
  });
  return appleTeamId;
}

async function getAppleTeamTypeFromEnvironmentOrOptionsAsync(options: {
  teamType?: AppleTeamType;
}): Promise<string> {
  if (options.teamType) {
    return options.teamType;
  }

  const appleTeamTypeFromEnvironment = resolveAppleTeamTypeFromEnvironment();
  if (appleTeamTypeFromEnvironment) {
    return appleTeamTypeFromEnvironment;
  }

  const { appleTeamType } = await promptAsync({
    type: 'select',
    message: 'Select your Apple Team Type:',
    name: 'appleTeamType',
    choices: [
      { title: 'Enterprise', value: AppleTeamType.IN_HOUSE },
      { title: 'Company/Organization', value: AppleTeamType.COMPANY_OR_ORGANIZATION },
      { title: 'Individual', value: AppleTeamType.INDIVIDUAL },
    ],
  });
  return appleTeamType;
}

export async function resolveAppleTeamAsync(
  options: {
    teamId?: string;
    teamName?: string;
    teamType?: AppleTeamType;
  } = {}
): Promise<Team> {
  const passedTeamType = await getAppleTeamTypeFromEnvironmentOrOptionsAsync(options);
  return {
    id: await getAppleTeamIdFromEnvironmentOrOptionsAsync(options),
    name: options.teamName,
    inHouse: passedTeamType === AppleTeamType.IN_HOUSE,
  };
}

function getAppleIdFromEnvironmentOrOptions({
  username,
  password,
  ...userCredentials
}: Partial<Auth.UserCredentials>): Partial<Auth.UserCredentials> {
  const passedAppleId = username || process.env.EXPO_APPLE_ID;
  // Only resolve the password if the username was provided.
  const passedAppleIdPassword = passedAppleId
    ? password || process.env.EXPO_APPLE_PASSWORD
    : undefined;

  return {
    ...userCredentials,
    username: passedAppleId,
    password: passedAppleIdPassword,
  };
}

async function promptUsernameAsync(): Promise<string> {
  Log.log('\u203A Log in to your Apple Developer account to continue');

  // Get the email address that was last used and set it as
  // the default value for quicker authentication.
  const lastAppleId = await getCachedUsernameAsync();

  const { username } = await promptAsync({
    type: 'text',
    name: 'username',
    message: `Apple ID:`,
    validate: (val: string) => val !== '',
    initial: lastAppleId ?? undefined,
  });

  if (username && username !== lastAppleId) {
    await cacheUsernameAsync(username);
  }

  return username;
}

async function cacheUsernameAsync(username: string): Promise<void> {
  // If a new email was used then store it as a suggestion for next time.
  // This functionality is disabled using the keychain mechanism.
  if (!Keychain.EXPO_NO_KEYCHAIN && username) {
    const cachedPath = JsonFileCache.usernameCachePath();
    await JsonFileCache.cacheAsync(cachedPath, { username });
  }
}

export async function promptPasswordAsync({
  username,
}: Pick<Auth.UserCredentials, 'username'>): Promise<string> {
  const cachedPassword = await getCachedPasswordAsync({ username });

  if (cachedPassword) {
    Log.log(`\u203A Using password for ${username} from your local Keychain`);
    Log.log(`  ${learnMore('https://docs.expo.dev/distribution/security#keychain')}`);
    return cachedPassword;
  }

  // https://docs.expo.dev/distribution/security/#apple-developer-account-credentials
  Log.log(
    wrapAnsi(
      chalk.bold(
        `\u203A The password is only used to authenticate with Apple and never stored on EAS servers`
      ),
      process.stdout.columns || 80
    )
  );
  Log.log(`  ${learnMore('https://bit.ly/2VtGWhU')}`);

  const { password } = await promptAsync({
    type: 'password',
    name: 'password',
    message: () => `Password (for ${username}):`,
    validate: (val: string) => val !== '',
  });

  // TODO: Save only after the auth completes successfully.
  await cachePasswordAsync({ username, password });
  return password;
}

async function getCachedUsernameAsync(): Promise<string | null> {
  if (Keychain.EXPO_NO_KEYCHAIN) {
    // Clear last used apple ID.
    await fs.remove(JsonFileCache.usernameCachePath());
    return null;
  }
  const cached = await JsonFileCache.getCacheAsync(JsonFileCache.usernameCachePath());
  const lastAppleId = cached?.username ?? null;
  return typeof lastAppleId === 'string' ? lastAppleId : null;
}

/**
 * Returns the same prefix used by Fastlane in order to potentially share access between services.
 * [Cite. Fastlane](https://github.com/fastlane/fastlane/blob/f831062fa6f4b216b8ee38949adfe28fc11a0a8e/credentials_manager/lib/credentials_manager/account_manager.rb#L8).
 *
 * @param appleId email address
 */
function getKeychainServiceName(appleId: string): string {
  return `deliver.${appleId}`;
}

export async function deletePasswordAsync({
  username,
}: Pick<Auth.UserCredentials, 'username'>): Promise<boolean> {
  const serviceName = getKeychainServiceName(username);
  const success = await Keychain.deletePasswordAsync({ username, serviceName });
  if (success) {
    Log.log('\u203A Removed Apple ID password from the native Keychain');
  }
  return success;
}

async function getCachedPasswordAsync({
  username,
}: Pick<Auth.UserCredentials, 'username'>): Promise<string | null> {
  // If the user opts out, delete the password.
  if (Keychain.EXPO_NO_KEYCHAIN) {
    await deletePasswordAsync({ username });
    return null;
  }

  const serviceName = getKeychainServiceName(username);
  return await Keychain.getPasswordAsync({ username, serviceName });
}

async function cachePasswordAsync({ username, password }: Auth.UserCredentials): Promise<boolean> {
  if (Keychain.EXPO_NO_KEYCHAIN) {
    Log.log('\u203A Skip storing Apple ID password in the local Keychain.');
    return false;
  }

  Log.log(`\u203A Saving Apple ID password to the local Keychain`);
  Log.log(`  ${learnMore('https://docs.expo.dev/distribution/security#keychain')}`);
  const serviceName = getKeychainServiceName(username);
  return await Keychain.setPasswordAsync({ username, password, serviceName });
}
