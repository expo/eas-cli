import { BundleId, CapabilityType, CapabilityTypeOption, Session, Teams } from '@expo/apple-utils';
import ora from 'ora';

import { AuthCtx, authenticateAsync } from './authenticate';
import { USE_APPLE_UTILS } from './experimental';
import { runActionAsync, travelingFastlane } from './fastlane';

export interface EnsureAppExistsOptions {
  enablePushNotifications?: boolean;
}

export interface AppLookupParams {
  accountName: string;
  projectName: string;
  bundleIdentifier: string;
}

export async function ensureAuthenticatedAsync(
  appleCtx: Omit<AuthCtx, 'fastlaneSession'>
): Promise<Omit<AuthCtx, 'fastlaneSession'>> {
  if (!Session.getSessionInfo()) {
    appleCtx = await authenticateAsync({
      appleId: appleCtx.appleId,
      teamId: appleCtx.team.id,
    });
  }
  Teams.setSelectedTeamId(appleCtx.team.id);
  return appleCtx;
}

async function ensureBundleIdExistsAsync(
  appleCtx: Omit<AuthCtx, 'fastlaneSession'>,
  { accountName, projectName, bundleIdentifier }: AppLookupParams,
  options: EnsureAppExistsOptions = {}
) {
  let spinner = ora(`Registering Bundle ID "${bundleIdentifier}"`).start();

  try {
    appleCtx = await ensureAuthenticatedAsync(appleCtx);

    // Get the bundle id
    let bundleId = await BundleId.findAsync({ identifier: bundleIdentifier });

    if (bundleId) {
      spinner.succeed('Bundle ID already registered');
    } else {
      // If it doesn't exist, create it
      bundleId = await BundleId.createAsync({
        name: `@${accountName}/${projectName}`,
        identifier: bundleIdentifier,
      });
      spinner.succeed(`Registered Bundle ID "${bundleIdentifier}"`);
    }

    spinner = ora(`Syncing app capabilities`).start();

    // Update the capabilities
    await bundleId.updateBundleIdCapabilityAsync({
      capabilityType: CapabilityType.PUSH_NOTIFICATIONS,
      option: options.enablePushNotifications ? CapabilityTypeOption.ON : CapabilityTypeOption.OFF,
      // TODO: Add more capabilities
    });
    spinner.succeed(`Sync'd app capabilities`);
  } catch (err) {
    if (err.message.match(/An App ID with Identifier '(.*)' is not available/)) {
      spinner.fail(
        `The bundle identifier "${bundleIdentifier}" is not available, please change it in your app config and try again.`
      );
    } else {
      spinner.fail(
        'Something went wrong when trying to ensure Bundle ID exists on App Store Connect!'
      );
    }
    throw err;
  }
}

export async function ensureAppExistsAsync(
  appleCtx: Omit<AuthCtx, 'fastlaneSession'>,
  app: AppLookupParams,
  options: EnsureAppExistsOptions = {}
) {
  if (USE_APPLE_UTILS) {
    return await ensureBundleIdExistsAsync(appleCtx, app, options);
  }

  const { appleId, appleIdPassword, team } = appleCtx;

  const spinner = ora(`Ensuring App ID exists on Apple Developer Portal...`).start();
  try {
    const { created } = await runActionAsync(travelingFastlane.ensureAppExists, [
      ...(options.enablePushNotifications ? ['--push-notifications'] : []),
      appleId,
      appleIdPassword,
      team.id,
      app.bundleIdentifier,
      `@${app.accountName}/${app.projectName}`,
    ]);
    if (created) {
      spinner.succeed(`App ID created with bundle identifier ${app.bundleIdentifier}.`);
    } else {
      spinner.succeed('App ID found on Apple Developer Portal.');
    }
  } catch (err) {
    spinner.fail(
      'Something went wrong when trying to ensure App ID exists on Apple Developer Portal!'
    );
    throw err;
  }
}
