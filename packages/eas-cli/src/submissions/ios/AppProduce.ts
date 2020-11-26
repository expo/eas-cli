import { App, RequestContext, Session, User } from '@expo/apple-utils/build';
import { getConfig, ProjectConfig } from '@expo/config';
import * as path from 'path';
import wordwrap from 'wordwrap';

import { getBundleIdentifier } from '../../build/ios/bundleIdentifer';
import { authenticateAsync, getRequestContext } from '../../credentials/ios/appstore/authenticate';
import { USE_APPLE_UTILS } from '../../credentials/ios/appstore/experimental';
import log from '../../log';
import { promptAsync } from '../../prompts';
import { IosSubmissionContext } from '../types';
import { runFastlaneAsync, travelingFastlane } from '../utils/fastlane';
import { sanitizeLanguage } from './utils/language';

interface ProduceOptions {
  appleId?: string;
  appName: string;
  bundleIdentifier: string;
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
  ascAppId: string;
};

export async function ensureAppStoreConnectAppExistsAsync(
  ctx: IosSubmissionContext
): Promise<AppStoreResult> {
  const projectConfig = getConfig(ctx.projectDir, { skipSDKVersionRequirement: true });
  const { exp } = projectConfig;

  const { bundleIdentifier, appName, language } = ctx.commandFlags;

  let resolvedBundleId: string;
  try {
    const description = getProjectConfigDescription(ctx.projectDir, projectConfig);
    resolvedBundleId =
      bundleIdentifier ??
      (await getBundleIdentifier(ctx.projectDir, exp, {
        displayAutoconfigMessage: false,
        configDescription: description,
      }));
  } catch (e) {
    throw new Error(
      `Please define "expo.ios.bundleIdentifier" in your app config or provide it using --bundle-identifier param.
Learn more here: https://expo.fyi/bundle-identifier`
    );
  }

  const options = {
    ...ctx.commandFlags,
    bundleIdentifier: resolvedBundleId,
    appName: appName ?? exp.name ?? (await promptForAppNameAsync()),
    language: sanitizeLanguage(language),
  };

  if (USE_APPLE_UTILS) {
    return await runProduceExperimentalAsync(options);
  }

  return await runProduceAsync(options);
}

async function isProvisioningAvailableAsync(requestCtx: RequestContext): Promise<boolean> {
  const session = await Session.getAnySessionInfo();
  // TODO: Investigate if username and email can be different
  const username = session?.user.emailAddress;
  const [user] = await User.getAsync(requestCtx, { query: { filter: { username } } });
  return user.attributes.provisioningAllowed;
}

async function runProduceExperimentalAsync(options: ProduceOptions): Promise<AppStoreResult> {
  const {
    appleId,
    appleTeamId,
    bundleIdentifier: bundleId,
    appName,
    language,
    companyName,
  } = options;

  const authCtx = await authenticateAsync({
    appleId,
    teamId: appleTeamId,
  });
  const requestCtx = getRequestContext(authCtx);

  log.addNewLineIfNone();

  if (await isProvisioningAvailableAsync(requestCtx)) {
    log(`Ensuring that bundle ID "${bundleId}" is registered on Apple Dev Center...`);
    await App.ensureBundleIdExistsAsync(requestCtx, {
      name: appName,
      bundleId,
    });
  } else {
    log.warn(
      `Provisioning is not available for user "${authCtx.appleId}", skipping bundle identifier check.`
    );
  }

  log(`Checking App Store Connect for "${appName}" (${bundleId})...`);
  let app = await App.findAsync(requestCtx, { bundleId });

  if (!app) {
    log(`Creating app "${appName}" (${bundleId}) on App Store Connect...`);
    try {
      app = await App.createAsync(requestCtx, {
        bundleId,
        name: appName,
        primaryLocale: language,
        companyName,
      });
    } catch (error) {
      if (error.message.match(/An App ID with Identifier '(.*)' is not available/)) {
        const providerName = authCtx.authState?.session.provider.name;
        throw new Error(
          `\nThe bundle identifier "${bundleId}" is not available to provider "${providerName}". Please change it in your app config and try again.\n`
        );
      }
      log.error('Failed to create the app in App Store Connect:');
      throw error;
    }
  } else {
    // TODO: Update app name when API gives us that possibility
  }

  // TODO: Maybe sync capabilities now as well
  log(`App "${app.attributes.name}" (${bundleId}) on App Store Connect is ready for your binary.`);

  return {
    appleId: authCtx.appleId,
    ascAppId: app.id,
  };
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
    const { appleId: ascAppId } = await runFastlaneAsync(
      travelingFastlane.appProduce,
      [bundleIdentifier, appName, appleId, language],
      updatedAppleCreds,
      true
    );

    return { appleId, ascAppId };
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

async function promptForAppNameAsync(): Promise<string> {
  const { appName } = await promptAsync({
    type: 'text',
    name: 'appName',
    message: 'How would you like to name your app?',
    validate: (val: string) => val !== '' || 'App name cannot be empty!',
  });
  return appName;
}

/**
 * Return a useful name describing the project config.
 * - dynamic: app.config.js
 * - static: app.json
 * - custom path app config relative to root folder
 * - both: app.config.js or app.json
 */
function getProjectConfigDescription(
  projectRoot: string,
  projectConfig: Partial<ProjectConfig>
): string {
  if (projectConfig.dynamicConfigPath) {
    const relativeDynamicConfigPath = path.relative(projectRoot, projectConfig.dynamicConfigPath);
    if (projectConfig.staticConfigPath) {
      return `${relativeDynamicConfigPath} or ${path.relative(
        projectRoot,
        projectConfig.staticConfigPath
      )}`;
    }
    return relativeDynamicConfigPath;
  } else if (projectConfig.staticConfigPath) {
    return path.relative(projectRoot, projectConfig.staticConfigPath);
  }
  return 'app.config.js/app.json';
}
