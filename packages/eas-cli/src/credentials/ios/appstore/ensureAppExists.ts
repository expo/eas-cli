import { BundleId, CapabilityType, CapabilityTypeOption } from '@expo/apple-utils';
import ora from 'ora';

import { AuthCtx, getRequestContext } from './authenticate';

export interface EnsureAppExistsOptions {
  enablePushNotifications?: boolean;
}

export interface AppLookupParams {
  accountName: string;
  projectName: string;
  bundleIdentifier: string;
}

export async function ensureAppExistsAsync(
  authCtx: AuthCtx,
  { accountName, projectName, bundleIdentifier }: AppLookupParams,
  options: EnsureAppExistsOptions = {}
) {
  const context = getRequestContext(authCtx);
  let spinner = ora(`Registering Bundle ID "${bundleIdentifier}"`).start();

  try {
    // Get the bundle id
    let bundleId = await BundleId.findAsync(context, { identifier: bundleIdentifier });

    if (bundleId) {
      spinner.succeed('Bundle ID already registered');
    } else {
      // If it doesn't exist, create it
      bundleId = await BundleId.createAsync(context, {
        name: `@${accountName}/${projectName}`,
        identifier: bundleIdentifier,
      });
      spinner.succeed(`Registered Bundle ID "${bundleIdentifier}"`);
    }

    spinner = ora(`Updating app capabilities`).start();

    // Update the capabilities
    await bundleId.updateBundleIdCapabilityAsync({
      capabilityType: CapabilityType.PUSH_NOTIFICATIONS,
      option: options.enablePushNotifications ? CapabilityTypeOption.ON : CapabilityTypeOption.OFF,
      // TODO: Add more capabilities
    });
    spinner.succeed(`Updated app capabilities`);
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
