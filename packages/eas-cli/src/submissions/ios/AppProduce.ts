import { App, RequestContext, Session, User } from '@expo/apple-utils/build';
import { getConfig } from '@expo/config';
import { Platform } from '@expo/eas-build-job';
import chalk from 'chalk';

import { authenticateAsync, getRequestContext } from '../../credentials/ios/appstore/authenticate';
import log from '../../log';
import { getAppIdentifierAsync } from '../../project/projectUtils';
import { promptAsync } from '../../prompts';
import { IosSubmissionContext } from '../types';
import { sanitizeLanguage } from './utils/language';

interface CreateAppOptions {
  appleId?: string;
  appName: string;
  bundleIdentifier: string;
  appleTeamId?: string;
  itcTeamId?: string;
  language?: string;
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

  const resolvedBundleId =
    bundleIdentifier ?? (await getAppIdentifierAsync(ctx.projectDir, Platform.iOS));
  if (!resolvedBundleId) {
    throw new Error(
      `Please define "expo.ios.bundleIdentifier" in your app config or provide it using --bundle-identifier param.
Learn more: https://expo.fyi/bundle-identifier`
    );
  }

  const options = {
    ...ctx.commandFlags,
    bundleIdentifier: resolvedBundleId,
    appName: appName ?? exp.name ?? (await promptForAppNameAsync()),
    language: sanitizeLanguage(language),
  };

  return await createAppStoreConnectAppAsync(options);
}

async function isProvisioningAvailableAsync(requestCtx: RequestContext): Promise<boolean> {
  const session = await Session.getAnySessionInfo();
  // TODO: Investigate if username and email can be different
  const username = session?.user.emailAddress;
  const [user] = await User.getAsync(requestCtx, { query: { filter: { username } } });
  return user.attributes.provisioningAllowed;
}

async function createAppStoreConnectAppAsync(options: CreateAppOptions): Promise<AppStoreResult> {
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

      if (
        // Name is invalid
        error.message.match(
          /App Name contains certain Unicode(.*)characters that are not permitted/
        ) ||
        // UnexpectedAppleResponse: An attribute value has invalid characters. - App Name contains certain Unicode symbols, emoticons, diacritics, special characters, or private use characters that are not permitted.
        // Name is taken
        error.message.match(/The App Name you entered is already being used/)
        // UnexpectedAppleResponse: The provided entity includes an attribute with a value that has already been used on a different account. - The App Name you entered is already being used. If you have trademark rights to
        // this name and would like it released for your use, submit a claim.
      ) {
        log.addNewLineIfNone();
        log.warn(
          `Change the name in your app config, or use a custom name with the ${chalk.bold(
            '--app-name'
          )} flag`
        );
        log.newLine();
      }
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

async function promptForAppNameAsync(): Promise<string> {
  const { appName } = await promptAsync({
    type: 'text',
    name: 'appName',
    message: 'How would you like to name your app?',
    validate: (val: string) => val !== '' || 'App name cannot be empty!',
  });
  return appName;
}
