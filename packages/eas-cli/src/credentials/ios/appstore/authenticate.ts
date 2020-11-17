import { Auth, InvalidUserCredentialsError, Session, Teams } from '@expo/apple-utils';
import chalk from 'chalk';
import assert from 'assert';
import wordwrap from 'wordwrap';

import log from '../../../log';
import { promptAsync, toggleConfirmAsync } from '../../../prompts';
import UserSettings from '../../../user/UserSettings';
import { USE_APPLE_UTILS } from './experimental';
import { runActionAsync, travelingFastlane } from './fastlane';
import * as Keychain from './keychain';

const APPLE_IN_HOUSE_TEAM_TYPE = 'in-house';
const IS_MAC = process.platform === 'darwin';

export type Options = {
  appleId?: string;
  teamId?: string;
  cookies?: AuthCtx['cookies'];
};

export type AppleCredentials = {
  appleIdPassword: string;
  appleId: string;
};

export type Team = {
  id: string;
  name: string;
  inHouse?: boolean;
};

type FastlaneTeam = {
  name: string;
  teamId: string;
  status: string;
  type: string;
};

export type AuthCtx = {
  appleId: string;
  appleIdPassword: string;
  team: Team;
  /**
   * Defined when using Fastlane
   */
  fastlaneSession?: string;
  /**
   * Can be used to restore the Apple auth state via apple-utils.
   */
  cookies?: Session.AuthState['cookies'];
};

export async function ensureAuthenticatedAsync(appleCtx: AuthCtx): Promise<AuthCtx> {
  assert(
    USE_APPLE_UTILS,
    'ensureAuthenticatedAsync can only be used with the experimental apple auth'
  );

  // Check if the current session from the server exists.
  // This check happens without performing a rate-limited network request to Apple.
  if (!Session.getSessionInfo()) {
    // Attempt to authenticate.
    appleCtx = await authenticateWithExperimentalAsync({
      appleId: appleCtx.appleId,
      teamId: appleCtx.team.id,
      cookies: appleCtx.cookies,
    });
  } else {
    // Set the team id in the case where the user is authenticated but a new team was selected (shouldn't happen).
    Teams.setSelectedTeamId(appleCtx.team.id);
  }

  return appleCtx;
}

async function authenticateWithExperimentalAsync(options: Options = {}): Promise<AuthCtx> {
  const { appleId, appleIdPassword } = await requestAppleCredentialsAsync(options);
  log(`Authenticating to Apple Developer Portal...`); // use log instead of spinner in case we need to prompt user for 2fa

  try {
    // TODO: The password isn't required for apple-utils. Remove the local prompt when we remove traveling Fastlane.
    const authContext = await Auth.loginAsync({
      username: appleId,
      password: appleIdPassword,
      cookies: options.cookies,
    });
    log(chalk.green('Authenticated with Apple Developer Portal successfully!'));

    // Get all of the teams
    const teams = await Teams.getTeamsAsync();
    const team = await chooseTeamAsync(teams, options.teamId);

    // Set the selected team ID internally
    Teams.setSelectedTeamId(team.id);

    // Get the JSON cookies in the custom YAML format used by Fastlane
    const fastlaneSession = Session.getSessionAsYAML();
    return {
      appleId: authContext.username,
      appleIdPassword: authContext.password ?? appleIdPassword,
      team,
      // Can be used to restore the auth state using apple-utils.
      cookies: authContext.cookies,
      // Defined for legacy usage in Turtle V1 or any other places where Fastlane is used in the servers.
      fastlaneSession,
    };
  } catch (error) {
    if (error instanceof InvalidUserCredentialsError) {
      log.error(error.message);
      // Remove the invalid password so it isn't automatically used...
      await deletePasswordAsync({ appleId });

      if (await toggleConfirmAsync({ message: 'Would you like to try again?' })) {
        // Don't pass credentials back or the method will throw
        return authenticateAsync({ teamId: options.teamId });
      }
    }
    log(chalk.red('Authentication with Apple Developer Portal failed!'));
    throw error;
  }
}

export async function authenticateAsync(options: Options = {}): Promise<AuthCtx> {
  if (USE_APPLE_UTILS) {
    return await authenticateWithExperimentalAsync(options);
  }
  const { appleId, appleIdPassword } = await requestAppleCredentialsAsync(options);
  log(`Authenticating to Apple Developer Portal...`); // use log instead of spinner in case we need to prompt user for 2fa
  try {
    const { teams, fastlaneSession } = await runActionAsync(
      travelingFastlane.authenticate,
      [appleId, appleIdPassword],
      {
        pipeStdout: true,
      }
    );
    log(chalk.green('Authenticated with Apple Developer Portal successfully!'));
    const team = await chooseTeamAsync(teams, options.teamId);
    return { appleId, appleIdPassword, team, fastlaneSession };
  } catch (err) {
    if (err.rawDump?.match(/Invalid username and password combination/)) {
      log(chalk.red('Invalid username and password combination, try again.'));
      const anotherPromptResult = await promptForAppleCredentialsAsync({
        firstAttempt: false,
      });
      return authenticateAsync({ ...options, ...anotherPromptResult });
    }
    log(chalk.red('Authentication with Apple Developer Portal failed!'));
    throw err;
  }
}

export async function requestAppleCredentialsAsync(options: Options): Promise<AppleCredentials> {
  return getAppleCredentialsFromParams(options) ?? (await promptForAppleCredentialsAsync());
}

function getAppleCredentialsFromParams({ appleId }: Options): AppleCredentials | null {
  if (!appleId) {
    return null;
  }
  const appleIdPassword = process.env.EXPO_APPLE_PASSWORD;

  // partial apple id params were set, assume user has intention of passing it in
  if (!appleIdPassword) {
    throw new Error(
      'In order to provide your Apple ID credentials, you must set the --apple-id flag and set the EXPO_APPLE_PASSWORD environment variable.'
    );
  }

  return {
    appleId,
    appleIdPassword,
  };
}

async function promptForAppleCredentialsAsync({
  firstAttempt = true,
}: { firstAttempt?: boolean } = {}): Promise<AppleCredentials> {
  if (firstAttempt) {
    const wrap = wordwrap(process.stdout.columns || 80);
    log(
      wrap(
        'Please enter your Apple Developer Program account credentials. ' +
          'These credentials are needed to manage certificates, keys and provisioning profiles ' +
          `in your Apple Developer account.`
      )
    );

    log(
      wrap(
        chalk.bold(
          `The password is only used to authenticate with Apple and never stored on Expo servers`
        )
      )
    );
    log(
      wrap(
        chalk.grey(
          `Learn more here https://docs.expo.io/distribution/security/#apple-developer-account-credentials`
        )
      )
    );
  }

  // Get the email address that was last used and set it as
  // the default value for quicker authentication.
  const lastAppleId = await getLastUsedAppleIdAsync();

  const { appleId: promptAppleId } = await promptAsync({
    type: 'text',
    name: 'appleId',
    message: `Apple ID:`,
    validate: (val: string) => !!val,
    initial: lastAppleId ?? undefined,
  });

  // If a new email was used then store it as a suggestion for next time.
  if (lastAppleId !== promptAppleId) {
    await UserSettings.setAsync('appleId', promptAppleId);
  }

  // Only check on the first attempt in case the user changed their password.
  if (firstAttempt) {
    const password = await getPasswordAsync({ appleId: promptAppleId });

    if (password) {
      log(
        `Using password from your local Keychain. ${chalk.dim(
          `Learn more ${chalk.underline('https://docs.expo.io/distribution/security#keychain')}`
        )}`
      );
      return { appleId: promptAppleId, appleIdPassword: password };
    }
  }
  const { appleIdPassword } = await promptAsync({
    type: 'password',
    name: 'appleIdPassword',
    message: `Password (for ${promptAppleId}):`,
    validate: (val: string) => !!val,
  });

  await setPasswordAsync({ appleId: promptAppleId, appleIdPassword });

  return { appleId: promptAppleId, appleIdPassword };
}

async function chooseTeamAsync(teams: FastlaneTeam[], userProvidedTeamId?: string): Promise<Team> {
  if (teams.length === 0) {
    throw new Error(`You have no team associated with your Apple account, cannot proceed.
(Do you have a paid Apple Developer account?)`);
  }

  if (userProvidedTeamId) {
    const foundTeam = teams.find(({ teamId }) => teamId === userProvidedTeamId);
    if (foundTeam) {
      log(`Using Apple Team with ID: ${userProvidedTeamId}`);
      return formatTeam(foundTeam);
    } else {
      log.warn(`Your account is not associated with Apple Team with ID: ${userProvidedTeamId}`);
    }
  }

  if (teams.length === 1) {
    const [team] = teams;
    log(`Only 1 team associated with your account, using Apple Team with ID: ${team.teamId}`);
    return formatTeam(team);
  } else {
    log(`You have ${teams.length} teams associated with your account`);
    const choices = teams.map((team, i) => ({
      title: `${i + 1}) ${team.teamId} "${team.name}" (${team.type})`,
      value: team,
    }));
    const { team } = await promptAsync({
      type: 'select',
      name: 'team',
      message: 'Which team would you like to use?',
      choices,
    });
    return formatTeam(team);
  }
}

function formatTeam({ teamId, name, type }: FastlaneTeam): Team {
  return {
    id: teamId,
    name: `${name} (${type})`,
    inHouse: type.toLowerCase() === APPLE_IN_HOUSE_TEAM_TYPE,
  };
}

async function getLastUsedAppleIdAsync(): Promise<string | null> {
  const lastAppleId = await UserSettings.getAsync('appleId', null);
  if (lastAppleId && typeof lastAppleId === 'string') {
    return lastAppleId;
  }
  return null;
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

async function deletePasswordAsync({ appleId }: Pick<AppleCredentials, 'appleId'>): Promise<void> {
  if (!IS_MAC) {
    return;
  }
  try {
    const serviceName = getKeychainServiceName(appleId);
    await Keychain.deletePasswordAsync({ username: appleId, serviceName });
    log('Removed Apple ID password from the native Keychain.');
  } catch (error) {
    log.warn('Failed to remove Apple ID password from the native Keychain');
  }
}

async function getPasswordAsync({
  appleId,
}: Pick<AppleCredentials, 'appleId'>): Promise<string | null> {
  if (!IS_MAC) {
    return null;
  }
  try {
    // If the user opts out, delete the password.
    if (Keychain.EXPO_NO_KEYCHAIN) {
      await deletePasswordAsync({ appleId });
      return null;
    }

    const serviceName = getKeychainServiceName(appleId);
    return Keychain.getPasswordAsync({ username: appleId, serviceName });
  } catch (error) {
    return null;
  }
}

async function setPasswordAsync({ appleId, appleIdPassword }: AppleCredentials): Promise<void> {
  if (!IS_MAC) {
    return;
  }
  if (Keychain.EXPO_NO_KEYCHAIN) {
    log('Skip storing Apple ID password in the local Keychain.');
    return;
  }

  log(
    `Saving Apple ID password to the local Keychain. ${chalk.dim(
      `Learn more ${chalk.underline('https://docs.expo.io/distribution/security#keychain')}`
    )}`
  );
  try {
    const serviceName = getKeychainServiceName(appleId);
    return Keychain.setPasswordAsync({ username: appleId, password: appleIdPassword, serviceName });
  } catch (error) {
    log.warn('Saving Apple ID password failed', error);
  }
}
