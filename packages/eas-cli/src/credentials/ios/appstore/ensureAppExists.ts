import { App, BundleId, CapabilityType, CapabilityTypeOption } from '@expo/apple-utils';
import chalk from 'chalk';
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
  options?: EnsureAppExistsOptions
) {
  return ensureBundleIdExistsWithNameAsync(
    authCtx,
    {
      name: `@${accountName}/${projectName}`,
      bundleIdentifier,
    },
    options
  );
}

export async function ensureBundleIdExistsWithNameAsync(
  authCtx: AuthCtx,
  { name, bundleIdentifier }: { name: string; bundleIdentifier: string },
  options?: EnsureAppExistsOptions
) {
  const context = getRequestContext(authCtx);
  let spinner = ora(`Linking bundle identifier ${chalk.dim(bundleIdentifier)}`).start();

  let bundleId: BundleId | null;
  try {
    // Get the bundle id
    bundleId = await BundleId.findAsync(context, { identifier: bundleIdentifier });

    if (!bundleId) {
      spinner.text = `Registering bundle identifier ${chalk.dim(bundleIdentifier)}`;
      // If it doesn't exist, create it
      bundleId = await BundleId.createAsync(context, {
        name,
        identifier: bundleIdentifier,
      });
    }
    spinner.succeed(`Bundle identifier registered ${chalk.dim(bundleIdentifier)}`);
  } catch (err) {
    if (err.message.match(/An App ID with Identifier '(.*)' is not available/)) {
      spinner.fail(
        `The bundle identifier ${chalk.bold(bundleIdentifier)} is not available to team "${
          authCtx.team.name
        }" (${authCtx.team.id}), please change it in your app config and try again.`
      );
    } else {
      spinner.fail(`Failed to register bundle identifier ${chalk.dim(bundleIdentifier)}`);
    }
    throw err;
  }

  if (options) {
    try {
      spinner = ora(`Syncing capabilities`).start();

      // Update the capabilities
      await bundleId.updateBundleIdCapabilityAsync({
        capabilityType: CapabilityType.PUSH_NOTIFICATIONS,
        option: options.enablePushNotifications
          ? CapabilityTypeOption.ON
          : CapabilityTypeOption.OFF,
        // TODO: Add more capabilities
      });
      spinner.succeed(`Synced capabilities`);
    } catch (err) {
      spinner.fail(`Failed to sync capabilities for "${bundleIdentifier}"`);

      throw err;
    }
  }
}

export async function ensureAppExistsWithNameAsync(
  authCtx: AuthCtx,
  {
    name,
    language,
    companyName,
    bundleIdentifier,
  }: { name: string; language?: string; companyName?: string; bundleIdentifier: string }
) {
  const context = getRequestContext(authCtx);
  const spinner = ora(`Linking to App Store app ${chalk.dim(bundleIdentifier)}`).start();

  let app = await App.findAsync(context, { bundleId: bundleIdentifier });

  if (!app) {
    spinner.text = `Creating App Store app ${chalk.bold(name)} ${chalk.dim(bundleIdentifier)}`;
    try {
      app = await App.createAsync(context, {
        bundleId: bundleIdentifier,
        name,
        primaryLocale: language,
        companyName,
      });
    } catch (error) {
      if (error.message.match(/An App ID with Identifier '(.*)' is not available/)) {
        const providerName = authCtx.authState?.session.provider.name;
        throw new Error(
          `\nThe bundle identifier "${bundleIdentifier}" is not available to provider "${providerName}". Please change it in your app config and try again.\n`
        );
      }

      spinner.fail(`Failed to create App Store app ${chalk.bold(name)}`);

      throw error;
    }
  } else {
    // TODO: Update app name when API gives us that possibility
  }
  spinner.succeed(`Prepped App Store for ${chalk.bold(name)} ${chalk.dim(bundleIdentifier)}`);
  return app;
}
