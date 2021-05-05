import { App, BundleId, CapabilityType, CapabilityTypeOption } from '@expo/apple-utils';
import chalk from 'chalk';
import ora from 'ora';

import { AuthCtx, getRequestContext } from './authenticate';
import { assertContractMessagesAsync } from './contractMessages';

export interface EnsureAppExistsOptions {
  enablePushNotifications?: boolean;
  enableAssociatedDomains?: boolean;
}

export interface AppLookupParams {
  accountName: string;
  projectName: string;
  bundleIdentifier: string;
}

export async function ensureBundleIdExistsAsync(
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
  const spinner = ora(`Linking bundle identifier ${chalk.dim(bundleIdentifier)}`).start();

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

      // Assert contract errors for easier resolution when the user has an expired developer account.
      if (err.message.match(/forbidden for security reasons/)) {
        await assertContractMessagesAsync(context);
      }
    }

    throw err;
  }

  if (options) {
    await syncCapabilities(bundleId, options);
  }
}

export async function syncCapabilities(
  bundleId: BundleId,
  options: EnsureAppExistsOptions
): Promise<void> {
  const spinner = ora(`Syncing capabilities`).start();

  try {
    const notifications = await bundleId.hasCapabilityAsync(CapabilityType.PUSH_NOTIFICATIONS);
    if (!notifications && options.enablePushNotifications) {
      await bundleId.updateBundleIdCapabilityAsync({
        capabilityType: CapabilityType.PUSH_NOTIFICATIONS,
        option: CapabilityTypeOption.ON,
      });
    } else if (notifications && !options.enablePushNotifications) {
      await bundleId.updateBundleIdCapabilityAsync({
        capabilityType: CapabilityType.PUSH_NOTIFICATIONS,
        option: CapabilityTypeOption.OFF,
      });
    }
    const associatedDomains = await bundleId.hasCapabilityAsync(CapabilityType.ASSOCIATED_DOMAINS);
    if (!associatedDomains && options.enableAssociatedDomains) {
      await bundleId.updateBundleIdCapabilityAsync({
        capabilityType: CapabilityType.ASSOCIATED_DOMAINS,
        option: CapabilityTypeOption.ON,
      });
    } else if (associatedDomains && !options.enableAssociatedDomains) {
      await bundleId.updateBundleIdCapabilityAsync({
        capabilityType: CapabilityType.ASSOCIATED_DOMAINS,
        option: CapabilityTypeOption.OFF,
      });
    }
    spinner.succeed(`Synced capabilities`);
  } catch (err) {
    spinner.fail(`Failed to sync capabilities ${chalk.dim(bundleId.attributes.identifier)}`);
    throw err;
  }
}

export async function ensureAppExistsAsync(
  authCtx: AuthCtx,
  {
    name,
    language,
    companyName,
    bundleIdentifier,
  }: { name: string; language?: string; companyName?: string; bundleIdentifier: string }
) {
  const context = getRequestContext(authCtx);
  const spinner = ora(`Linking to App Store ${chalk.dim(bundleIdentifier)}`).start();

  let app = await App.findAsync(context, { bundleId: bundleIdentifier });

  if (!app) {
    spinner.text = `Creating App Store app ${chalk.bold(name)} ${chalk.dim(bundleIdentifier)}`;
    try {
      // Assert contract errors when the user needs to create an app.
      await assertContractMessagesAsync(context, spinner);

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

      spinner.fail(`Failed to create App Store app ${chalk.dim(name)}`);
      error.message +=
        '\nPlease visit https://appstoreconnect.apple.com and resolve any warnings, then try again.';
      throw error;
    }
  } else {
    // TODO: Update app name when API gives us that possibility
  }
  spinner.succeed(`Prepared App Store for ${chalk.bold(name)} ${chalk.dim(bundleIdentifier)}`);
  return app;
}
