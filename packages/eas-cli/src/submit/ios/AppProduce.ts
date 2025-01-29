import { RequestContext, Session, User } from '@expo/apple-utils';
import { Platform } from '@expo/eas-build-job';

import { sanitizeLanguage } from './utils/language';
import { getRequestContext } from '../../credentials/ios/appstore/authenticate';
import {
  ensureAppExistsAsync,
  ensureBundleIdExistsWithNameAsync,
} from '../../credentials/ios/appstore/ensureAppExists';
import { ensureTestFlightGroupExistsAsync } from '../../credentials/ios/appstore/ensureTestFlightGroup';
import Log from '../../log';
import { getBundleIdentifierAsync } from '../../project/ios/bundleIdentifier';
import { promptAsync } from '../../prompts';
import { SubmissionContext } from '../context';

interface CreateAppOptions {
  appleId?: string;
  appName: string;
  bundleIdentifier: string;
  appleTeamId?: string;
  language?: string;
  companyName?: string;
  sku?: string;
}

type AppStoreResult = {
  ascAppIdentifier: string;
};

export async function ensureAppStoreConnectAppExistsAsync(
  ctx: SubmissionContext<Platform.IOS>
): Promise<AppStoreResult> {
  const { exp } = ctx;
  const { appName, language } = ctx.profile;
  const options = {
    ...ctx.profile,
    bundleIdentifier:
      ctx.applicationIdentifierOverride ??
      ctx.profile.bundleIdentifier ??
      (await getBundleIdentifierAsync(ctx.projectDir, exp, ctx.vcsClient)),
    appName: appName ?? exp.name ?? (await promptForAppNameAsync()),
    language: sanitizeLanguage(language),
  };
  return await createAppStoreConnectAppAsync(ctx, options);
}

async function isProvisioningAvailableAsync(requestCtx: RequestContext): Promise<boolean> {
  const session = Session.getAnySessionInfo();
  // TODO: Investigate if username and email can be different
  const username = session?.user.emailAddress;
  const [user] = await User.getAsync(requestCtx, { query: { filter: { username } } });
  return user.attributes.provisioningAllowed;
}

async function createAppStoreConnectAppAsync(
  ctx: SubmissionContext<Platform.IOS>,
  options: CreateAppOptions
): Promise<AppStoreResult> {
  const {
    appleId,
    appleTeamId,
    bundleIdentifier: bundleId,
    appName,
    language,
    companyName,
    sku,
  } = options;

  const userAuthCtx = await ctx.credentialsCtx.appStore.ensureUserAuthenticatedAsync({
    appleId,
    teamId: appleTeamId,
  });
  const requestCtx = getRequestContext(userAuthCtx);

  Log.addNewLineIfNone();

  if (await isProvisioningAvailableAsync(requestCtx)) {
    await ensureBundleIdExistsWithNameAsync(userAuthCtx, {
      name: appName,
      bundleIdentifier: bundleId,
    });
  } else {
    Log.warn(
      `Provisioning is not available for Apple User: ${userAuthCtx.appleId}, skipping bundle identifier check.`
    );
  }

  const app = await ensureAppExistsAsync(userAuthCtx, {
    name: appName,
    language,
    companyName,
    bundleIdentifier: bundleId,
    sku,
  });

  try {
    await ensureTestFlightGroupExistsAsync(app);
  } catch (error: any) {
    // This process is not critical to the app submission so we shouldn't let it fail the entire process.
    Log.error(
      'Failed to create an internal TestFlight group. This can be done manually in the App Store Connect website.'
    );
    Log.error(error);
  }

  return {
    ascAppIdentifier: app.id,
  };
}

async function promptForAppNameAsync(): Promise<string> {
  const { appName } = await promptAsync({
    type: 'text',
    name: 'appName',
    message: 'What would you like to name your app?',
    validate: (val: string) => val !== '' || 'App name cannot be empty!',
  });
  return appName;
}
