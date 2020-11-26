import { App, RequestContext, Session, User } from '@expo/apple-utils/build';
import { getConfig } from '@expo/config';

import { getBundleIdentifier } from '../../build/ios/bundleIdentifer';
import { authenticateAsync, getRequestContext } from '../../credentials/ios/appstore/authenticate';
import log from '../../log';
import { promptAsync } from '../../prompts';
import { IosSubmissionContext } from '../types';
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

type AppStoreResult = {
  appleId: string;
  ascAppId: string;
};

export async function ensureAppStoreConnectAppExistsAsync(
  ctx: IosSubmissionContext
): Promise<AppStoreResult> {
  const { exp } = getConfig(ctx.projectDir, { skipSDKVersionRequirement: true });

  const { bundleIdentifier, appName, language } = ctx.commandFlags;

  let resolvedBundleId: string;
  try {
    resolvedBundleId =
      bundleIdentifier ??
      (await getBundleIdentifier(ctx.projectDir, exp, {
        displayAutoconfigMessage: false,
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

  return await runProduceExperimentalAsync(options);
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

async function promptForAppNameAsync(): Promise<string> {
  const { appName } = await promptAsync({
    type: 'text',
    name: 'appName',
    message: 'How would you like to name your app?',
    validate: (val: string) => val !== '' || 'App name cannot be empty!',
  });
  return appName;
}
