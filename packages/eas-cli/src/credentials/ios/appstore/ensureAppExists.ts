import AppleUtils from '@expo/apple-utils';
import { JSONObject } from '@expo/json-file';
import chalk from 'chalk';

import Log from '../../../log.js';
import { ora } from '../../../ora.js';
import { getRequestContext, isUserAuthCtx } from './authenticate.js';
import { AuthCtx, UserAuthCtx } from './authenticateTypes.js';
import { syncCapabilitiesForEntitlementsAsync } from './bundleIdCapabilities.js';
import { syncCapabilityIdentifiersForEntitlementsAsync } from './capabilityIdentifiers.js';
import { assertContractMessagesAsync } from './contractMessages.js';

const { App, BundleId } = AppleUtils;

export interface IosCapabilitiesOptions {
  entitlements: JSONObject;
}

export interface AppLookupParams {
  accountName: string;
  projectName: string;
  bundleIdentifier: string;
}

export async function ensureBundleIdExistsAsync(
  authCtx: AuthCtx,
  { accountName, projectName, bundleIdentifier }: AppLookupParams,
  options?: IosCapabilitiesOptions
): Promise<void> {
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
  options?: IosCapabilitiesOptions
): Promise<void> {
  const context = getRequestContext(authCtx);
  const spinner = ora(`Linking bundle identifier ${chalk.dim(bundleIdentifier)}`).start();

  let bundleId: AppleUtils.BundleId | null;
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
  } catch (err: any) {
    if (err.message.match(/An App ID with Identifier '(.*)' is not available/)) {
      spinner.fail(
        `The bundle identifier ${chalk.bold(bundleIdentifier)} is not available to team "${
          authCtx.team.name
        }" (${authCtx.team.id}), please change it in your app config and try again.`
      );
    } else {
      spinner.fail(`Failed to register bundle identifier ${chalk.dim(bundleIdentifier)}`);

      // Assert contract errors for easier resolution when the user has an expired developer account.
      if (
        err.message.match(/forbidden for security reasons/) ||
        // Unable to process request - PLA Update available - You currently don't have access to this membership resource. To resolve this issue, agree to the latest Program License Agreement in your developer account.
        err.message.match(/agree/)
      ) {
        if (isUserAuthCtx(authCtx)) {
          await assertContractMessagesAsync(context);
        } else {
          Log.warn(
            `You currently don't have access to this membership resource. To resolve this issue, agree to the latest Program License Agreement in your developer account.`
          );
        }
      }
    }

    throw err;
  }

  if (options) {
    await syncCapabilitiesAsync(bundleId, options);
  }
}

export async function syncCapabilitiesAsync(
  bundleId: AppleUtils.BundleId,
  { entitlements }: IosCapabilitiesOptions
): Promise<void> {
  const spinner = ora(`Syncing capabilities`).start();

  // Stop spinning in debug mode so we can print other information
  if (Log.isDebug) {
    spinner.stop();
  }

  try {
    const { enabled, disabled } = await syncCapabilitiesForEntitlementsAsync(
      bundleId,
      entitlements
    );
    const results =
      [buildMessage('Enabled', enabled), buildMessage('Disabled', disabled)]
        .filter(Boolean)
        .join(' | ') || 'No updates';

    spinner.succeed(`Synced capabilities: ` + chalk.dim(results));
  } catch (err) {
    spinner.fail(`Failed to sync capabilities ${chalk.dim(bundleId.attributes.identifier)}`);
    throw err;
  }

  // Always run this after syncing the capabilities...
  await syncCapabilityIdentifiersAsync(bundleId, { entitlements });
}

const buildMessage = (title: string, items: string[]): string =>
  items.length ? `${title}: ${items.join(', ')}` : '';

export async function syncCapabilityIdentifiersAsync(
  bundleId: AppleUtils.BundleId,
  { entitlements }: IosCapabilitiesOptions
): Promise<void> {
  const spinner = ora(`Syncing capabilities identifiers`).start();

  // Stop spinning in debug mode so we can print other information
  if (Log.isDebug) {
    spinner.stop();
  }

  try {
    const { created, linked } = await syncCapabilityIdentifiersForEntitlementsAsync(
      bundleId,
      entitlements
    );

    const results =
      [buildMessage('Created', created), buildMessage('Linked', linked)]
        .filter(Boolean)
        .join(' | ') || 'No updates';

    spinner.succeed(`Synced capability identifiers: ` + chalk.dim(results));
  } catch (err) {
    spinner.fail(
      `Failed to sync capability identifiers ${chalk.dim(bundleId.attributes.identifier)}`
    );
    throw err;
  }
}

export async function ensureAppExistsAsync(
  userAuthCtx: UserAuthCtx,
  {
    name,
    language,
    companyName,
    bundleIdentifier,
    sku,
  }: {
    name: string;
    language?: string;
    companyName?: string;
    bundleIdentifier: string;
    sku?: string;
  }
): Promise<AppleUtils.App> {
  const context = getRequestContext(userAuthCtx);
  const spinner = ora(`Linking to App Store Connect ${chalk.dim(bundleIdentifier)}`).start();

  let app = await App.findAsync(context, { bundleId: bundleIdentifier });
  if (!app) {
    spinner.text = `Creating App Store Connect app ${chalk.bold(name)} ${chalk.dim(
      bundleIdentifier
    )}`;
    try {
      // Assert contract errors when the user needs to create an app.
      await assertContractMessagesAsync(context, spinner);
      /**
       * **Does not support App Store Connect API (CI).**
       */
      app = await App.createAsync(context, {
        bundleId: bundleIdentifier,
        name,
        primaryLocale: language,
        companyName,
        sku,
      });
    } catch (error: any) {
      if (error.message.match(/An App ID with Identifier '(.*)' is not available/)) {
        throw new Error(
          `\nThe bundle identifier "${bundleIdentifier}" is not available to provider "${userAuthCtx.authState?.session.provider.name}. Please change it in your app config and try again.\n`
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
  spinner.succeed(
    `Prepared App Store Connect for ${chalk.bold(name)} ${chalk.dim(bundleIdentifier)}`
  );
  return app;
}
