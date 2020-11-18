import { BundleId, CapabilityType, CapabilityTypeOption } from '@expo/apple-utils';
import ora from 'ora';

import { AuthCtx } from './authenticate';
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

async function ensureBundleIdExistsAsync(
  { accountName, projectName, bundleIdentifier }: AppLookupParams,
  options: EnsureAppExistsOptions = {}
) {
  let spinner = ora(`Registering Bundle ID "${bundleIdentifier}"`).start();

  try {
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
  { appleId, appleIdPassword, team }: Pick<AuthCtx, 'appleId' | 'appleIdPassword' | 'team'>,
  app: AppLookupParams,
  options: EnsureAppExistsOptions = {}
) {
  if (USE_APPLE_UTILS) {
    return await ensureBundleIdExistsAsync(app, options);
  }

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
