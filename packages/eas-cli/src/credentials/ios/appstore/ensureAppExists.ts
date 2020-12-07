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
  let spinner = ora(`Checking bundle identifier "${bundleIdentifier}"`).start();

  let bundleId: BundleId | null;
  try {
    // Get the bundle id
    bundleId = await BundleId.findAsync(context, { identifier: bundleIdentifier });

    if (!bundleId) {
      spinner.text = `Registering bundle identifier "${bundleIdentifier}"`;
      // If it doesn't exist, create it
      bundleId = await BundleId.createAsync(context, {
        name: `@${accountName}/${projectName}`,
        identifier: bundleIdentifier,
      });
    }
    spinner.succeed(`Bundle identifier "${bundleIdentifier}" registered`);
  } catch (err) {
    if (err.message.match(/An App ID with Identifier '(.*)' is not available/)) {
      spinner.fail(
        `The bundle identifier "${bundleIdentifier}" is not available to team "${authCtx.team.name}" (${authCtx.team.id}), please change it in your app config and try again.`
      );
    } else {
      spinner.fail('Failed to register bundle identifier');
    }
    throw err;
  }

  try {
    spinner = ora(`Syncing capabilities`).start();

    // Update the capabilities
    await bundleId.updateBundleIdCapabilityAsync({
      capabilityType: CapabilityType.PUSH_NOTIFICATIONS,
      option: options.enablePushNotifications ? CapabilityTypeOption.ON : CapabilityTypeOption.OFF,
      // TODO: Add more capabilities
    });
    spinner.succeed(`Synced capabilities`);
  } catch (err) {
    spinner.fail(`Failed to sync capabilities for "${bundleIdentifier}"`);

    throw err;
  }
}
