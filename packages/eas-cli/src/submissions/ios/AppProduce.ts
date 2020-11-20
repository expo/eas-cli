import { getConfig } from '@expo/config';
import chalk from 'chalk';
import wordwrap from 'wordwrap';

import { authenticateAsync } from '../../credentials/ios/appstore/authenticate';
import log from '../../log';
import { promptAsync } from '../../prompts';
import { IosSubmissionContext } from '../types';
import { runFastlaneAsync, travelingFastlane } from '../utils/fastlane';
import { validateLanguage } from './utils/language';

/////////////////////////////////////////////////////////

interface ProduceOptions {
  appleId?: string;
  appName?: string;
  bundleIdentifier?: string;
  appleTeamId?: string;
  itcTeamId?: string;
  language?: string;
  companyName?: string;
  sku?: string;
}

interface ProduceCredentials {
  appleId?: string;
  appleIdPassword?: string;
  appleTeamId?: string;
  itcTeamId?: string;
  companyName?: string;
  sku?: string;
}

type AppStoreResult = {
  appleId: string;
  appAppleId: string;
};

export async function ensureAppExistsAsync(ctx: IosSubmissionContext): Promise<AppStoreResult> {
  const { exp } = getConfig(ctx.projectDir, { skipSDKVersionRequirement: true });

  const { bundleIdentifier, appName, language } = ctx.commandFlags;

  const options = {
    ...ctx.commandFlags,
    bundleIdentifier:
      bundleIdentifier ?? exp.ios?.bundleIdentifier ?? (await promptForBundleIdAsync()),
    appName: appName ?? exp.name ?? (await promptForAppNameAsync()),
    language: validateLanguage(language) ?? 'English',
  };

  return await runProduceAsync(options);
}

async function runProduceAsync(options: ProduceOptions): Promise<AppStoreResult> {
  const { bundleIdentifier, appName, language, companyName, sku } = options;

  const { appleId, appleIdPassword, team } = await authenticateAsync({
    appleId: options.appleId,
    teamId: options.appleTeamId,
  });

  const appleCreds: ProduceCredentials = {
    appleId,
    appleIdPassword,
    appleTeamId: team.id,
  };
  const itcTeamId = options.itcTeamId ?? (await resolveItcTeamId(appleCreds));
  const updatedAppleCreds = {
    ...appleCreds,
    itcTeamId,
    companyName,
    sku,
  };

  log('Ensuring the app exists on App Store Connect, this may take a while...');
  try {
    const { appleId: appAppleId } = await runFastlaneAsync(
      travelingFastlane.appProduce,
      [bundleIdentifier, appName, appleId, language],
      updatedAppleCreds,
      true
    );

    return { appleId, appAppleId };
  } catch (err) {
    const wrap = wordwrap(process.stdout.columns || 80);
    if (err.message.match(/You must provide a company name to use on the App Store/)) {
      log.error(
        wrap(
          'You haven\'t uploaded any app to App Store yet. Please provide your company name with --company-name "COMPANY NAME"'
        )
      );
    } else if (err.message.match(/The Bundle ID you entered has already been used./)) {
      log.warn(
        wrap(
          'The Bundle ID you entered has already been used. If you already have app on App Store Connect, ' +
            'please skip this step and provide App Apple ID directly'
        )
      );
    } else if (err.message.match(/The app name you entered is already being used./)) {
      log.error('The app name you entered is already being used.');
    }
    throw err;
  }
}

async function resolveItcTeamId(appleCreds: ProduceCredentials): Promise<string> {
  log('Resolving your App Store Connect team...');
  const { itc_team_id: itcTeamId } = await runFastlaneAsync(
    travelingFastlane.resolveItcTeamId,
    [],
    appleCreds
  );
  return itcTeamId;
}

async function promptForBundleIdAsync(): Promise<string> {
  log.addNewLineIfNone();
  log('Please enter your iOS bundle identifier.');
  log('You can also specify ' + chalk.italic('ios.bundleIdentifier') + ' in app.json file');

  const { bundleId } = await promptAsync({
    type: 'text',
    name: 'bundleId',
    message: 'Bundle Identifier: ',
    // TODO: Add proper validation for this
    validate: (val: string) => val !== '' || 'Bundle Identifier cannot be empty!',
  });

  return bundleId;
}

async function promptForAppNameAsync(): Promise<string> {
  const { appName } = await promptAsync({
    type: 'text',
    name: 'appName',
    message: 'How would you like to name your app?',
    validate: (val: string) => val !== '' || 'App name cannot be empty!',
  });
  return appName;
}
