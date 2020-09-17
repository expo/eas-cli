import chalk from 'chalk';
import terminalLink from 'terminal-link';
import wordwrap from 'wordwrap';

import log from '../../../log';
import { prompt } from '../../../prompts';
import UserSettings from '../../../utils/UserSettings';
import { runActionAsync, travelingFastlane } from './fastlane';
import * as Keychain from './keychain';

const APPLE_IN_HOUSE_TEAM_TYPE = 'in-house';
const IS_MAC = process.platform === 'darwin';

export type Options = {
  appleId?: string;
  teamId?: string;
};

type AppleCredentials = {
  appleIdPassword: string;
  appleId: string;
};

export type Team = {
  id: string;
  name?: string;
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
  fastlaneSession: string;
};

export async function authenticateAsync(options: Options = {}): Promise<AuthCtx> {
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

    // https://docs.expo.io/distribution/security/#apple-developer-account-credentials
    const here = terminalLink('here', 'https://bit.ly/2VtGWhU');
    log(
      wrap(
        chalk.bold(
          `The password is only used to authenticate with Apple and never stored on Expo servers`
        )
      )
    );
    log(wrap(chalk.grey(`Learn more ${here}`)));
  }

  // Get the email address that was last used and set it as
  // the default value for quicker authentication.
  const lastAppleId = await getLastUsedAppleIdAsync();

  const { appleId: promptAppleId } = await prompt({
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
  const { appleIdPassword } = await prompt({
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
    const { team } = await prompt({
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
