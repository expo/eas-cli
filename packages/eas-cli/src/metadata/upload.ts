import { ExpoConfig } from '@expo/config';
import { SubmitProfile } from '@expo/eas-json';

import { AppleData } from './apple/data';
import { createAppleTasks } from './apple/tasks';
import { getAppStoreAuthAsync } from './auth';
import { createAppleReader, loadConfigAsync } from './config/resolve';
import { MetadataConfig } from './config/schema';
import { MetadataUploadError, MetadataValidationError, logMetadataValidationError } from './errors';
import { subscribeTelemetryAsync } from './utils/telemetry';
import { Analytics, MetadataEvent } from '../analytics/AnalyticsManager';
import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { CredentialsContext } from '../credentials/context';
import Log from '../log';
import { confirmAsync } from '../prompts';

/**
 * Sync a local store configuration with the stores.
 * Note, only App Store is supported at this time.
 */
export async function uploadMetadataAsync({
  projectDir,
  profile,
  exp,
  analytics,
  credentialsCtx,
  nonInteractive,
  graphqlClient,
  projectId,
}: {
  projectDir: string;
  profile: SubmitProfile;
  exp: ExpoConfig;
  analytics: Analytics;
  credentialsCtx: CredentialsContext;
  nonInteractive: boolean;
  graphqlClient: ExpoGraphqlClient;
  projectId: string;
}): Promise<{ appleLink: string }> {
  const storeConfig = await loadConfigWithValidationPromptAsync(
    projectDir,
    profile,
    nonInteractive
  );
  const { app, auth } = await getAppStoreAuthAsync({
    exp,
    credentialsCtx,
    projectDir,
    profile,
    nonInteractive,
    graphqlClient,
    projectId,
  });

  const { unsubscribeTelemetry, executionId } = await subscribeTelemetryAsync(
    analytics,
    MetadataEvent.APPLE_METADATA_UPLOAD,
    { app, auth }
  );

  Log.addNewLineIfNone();
  Log.log('Uploading App Store configuration...');

  const errors: Error[] = [];
  const config = createAppleReader(storeConfig);

  /**
   * Warn the user if the store config doesn't include the app's
   * primary locale. Pushes that only include non-primary locales
   * may not appear on the ASC dashboard - due to ASC showing the primary language
   * by default which could lead to a confusing experience.
   * @example
   * en-gb: {}
   * en-us: { title: "my-app", description: "my-app", keywords: ["cool-app"] }
   */
  const locales = config.getLocales();
  const primaryLocale = app.attributes.primaryLocale;

  if (primaryLocale && locales.length > 0 && !locales.includes(primaryLocale)) {
    Log.warn(`
      Your store configuration includes ${locales.map(locale => `"${locale}"`).join(', ')}, but not the app's primary locale "${primaryLocale}".
      
      App Store Connect displays the primary locale by default, so changes may not be visible there.

      To fix this, either:
        • Add a "${primaryLocale}" entry to your store.config.json.
        • Change the app's primary language in App Store Connect.
      `);
  }

  const tasks = createAppleTasks({
    // We need to resolve a different version as soon as possible.
    // This version is the parent model of all changes we are going to push.
    version: config.getVersion()?.versionString,
  });

  const taskCtx = { app, projectDir };

  for (const task of tasks) {
    try {
      await task.prepareAsync({ context: taskCtx });
    } catch (error: any) {
      errors.push(error);
    }
  }

  for (const task of tasks) {
    try {
      await task.uploadAsync({ config, context: taskCtx as AppleData });
    } catch (error: any) {
      errors.push(error);
    }
  }

  unsubscribeTelemetry();

  if (errors.length > 0) {
    throw new MetadataUploadError(errors, executionId);
  }

  return {
    appleLink: `https://appstoreconnect.apple.com/apps/${app.id}/appstore`,
  };
}

async function loadConfigWithValidationPromptAsync(
  projectDir: string,
  profile: SubmitProfile,
  nonInteractive: boolean
): Promise<MetadataConfig> {
  try {
    return await loadConfigAsync({ projectDir, profile });
  } catch (error) {
    if (error instanceof MetadataValidationError) {
      if (nonInteractive) {
        logMetadataValidationError(error);
        throw error;
      }

      logMetadataValidationError(error);
      Log.newLine();
      Log.warn(
        'Without further updates, the current store configuration can fail to be synchronized with the App Store or pass App Store review.'
      );

      if (
        await confirmAsync({
          message: 'Do you still want to push the store configuration?',
        })
      ) {
        return await loadConfigAsync({
          projectDir,
          profile,
          skipValidation: true,
        });
      }
    }

    throw error;
  }
}
