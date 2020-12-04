import chalk from 'chalk';
import * as fs from 'fs-extra';
import wordwrap from 'wordwrap';

import { JsonFileCache, Auth } from '@expo/apple-utils';
import * as Keychain from './Keychain';
import log, { learnMore } from '../../../log';
import { promptAsync } from '../../../prompts';

const { UserCredentials } = Auth;

export async function resolveCredentialsAsync(
  options: Partial<UserCredentials>
): Promise<Partial<UserCredentials>> {
  const credentials = getAppleIdFromEnvironmentOrOptions(options);

  if (!credentials.username) {
    credentials.username = await promptUsernameAsync();
  }

  return credentials;
}

function getAppleIdFromEnvironmentOrOptions({
  username,
  password,
  ...userCredentials
}: Partial<UserCredentials>): Partial<UserCredentials> {
  const passedAppleId = username || process.env.EXPO_APPLE_ID;
  const passedAppleIdPassword = passedAppleId
    ? password || process.env.EXPO_APPLE_PASSWORD || process.env.EXPO_APPLE_ID_PASSWORD
    : undefined;

  if (process.env.EXPO_APPLE_ID_PASSWORD) {
    log.error('EXPO_APPLE_ID_PASSWORD is deprecated, please use EXPO_APPLE_PASSWORD instead!');
  }

  return {
    ...userCredentials,
    username: passedAppleId,
    password: passedAppleIdPassword,
  };
}

export async function promptUsernameAsync(): Promise<string> {
  const wrap = wordwrap(process.stdout.columns || 80);
  log(wrap('Log in to your Apple Developer account to continue'));

  // Get the email address that was last used and set it as
  // the default value for quicker authentication.
  const lastAppleId = await getCachedUsernameAsync();

  const { username } = await promptAsync(
    {
      type: 'text',
      name: 'username',
      message: `Apple ID:`,
      validate: (val: string) => val !== '',
      initial: lastAppleId ?? undefined,
    },
    {
      nonInteractiveHelp: 'Pass your Apple ID using the EXPO_APPLE_ID environment variable',
    }
  );

  if (username && username !== lastAppleId) {
    await cacheUsernameAsync(username);
  }

  return username;
}

export async function cacheUsernameAsync(username: string): Promise<void> {
  // If a new email was used then store it as a suggestion for next time.
  // This functionality is disabled using the keychain mechanism.
  if (!Keychain.EXPO_NO_KEYCHAIN && username) {
    const cachedPath = JsonFileCache.usernameCachePath();
    await JsonFileCache.cacheAsync(cachedPath, { username });
  }
}

export async function promptPasswordAsync({
  username,
}: Pick<UserCredentials, 'username'>): Promise<string> {
  const cachedPassword = await getCachedPasswordAsync({ username });

  if (cachedPassword) {
    log(
      `Using password for ${username} from your local Keychain. ${learnMore(
        'https://docs.expo.io/distribution/security#keychain'
      )}`
    );
    return cachedPassword;
  }

  const wrap = wordwrap(process.stdout.columns || 80);

  // https://docs.expo.io/distribution/security/#apple-developer-account-credentials
  log(
    wrap(
      chalk.bold(
        `The password is only used to authenticate with Apple and never stored on Expo servers`
      )
    )
  );
  log(wrap(learnMore('https://bit.ly/2VtGWhU')));

  const { password } = await promptAsync(
    {
      type: 'password',
      name: 'password',
      message: () => `Password (for ${username}):`,
      validate: (val: string) => val !== '',
    },
    {
      nonInteractiveHelp:
        'Pass your Apple ID password using the EXPO_APPLE_PASSWORD environment variable',
    }
  );

  // TODO: Save only after the auth completes successfully.
  await cachePasswordAsync({ username, password });
  return password;
}

export async function getCachedUsernameAsync(): Promise<string | null> {
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

async function deletePasswordAsync({
  username,
}: Pick<UserCredentials, 'username'>): Promise<boolean> {
  const serviceName = getKeychainServiceName(username);
  const success = await Keychain.deletePasswordAsync({ username, serviceName });
  if (success) {
    log('Removed Apple ID password from the native Keychain.');
  }
  return success;
}

export async function getCachedPasswordAsync({
  username,
}: Pick<UserCredentials, 'username'>): Promise<string | null> {
  // If the user opts out, delete the password.
  if (Keychain.EXPO_NO_KEYCHAIN) {
    await deletePasswordAsync({ username });
    return null;
  }

  const serviceName = getKeychainServiceName(username);
  return Keychain.getPasswordAsync({ username, serviceName });
}

async function cachePasswordAsync({ username, password }: UserCredentials): Promise<boolean> {
  if (Keychain.EXPO_NO_KEYCHAIN) {
    log('Skip storing Apple ID password in the local Keychain.');
    return false;
  }

  log(
    `Saving Apple ID password to the local Keychain. ${learnMore(
      'https://docs.expo.io/distribution/security#keychain'
    )}`
  );
  const serviceName = getKeychainServiceName(username);
  return Keychain.setPasswordAsync({ username, password, serviceName });
}
