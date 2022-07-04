import AppleUtils from '@expo/apple-utils';
import assert from 'assert';
import chalk from 'chalk';

import Log from '../../../log.js';
import { logAsync } from '../../utils/log.js';
import { retryIfNullAsync } from '../../utils/retry.js';
import { AppleTask, TaskDownloadOptions, TaskPrepareOptions, TaskUploadOptions } from '../task.js';

const { Platform } = AppleUtils;

export type AppVersionOptions = {
  /** If we should use the live version of the app (if available - defaults to false) */
  editLive: boolean;
  /** The platform to use (defaults to IOS) */
  platform: AppleUtils.Platform;
};

export type AppVersionData = {
  /** The current selected app store version to update */
  version: AppleUtils.AppStoreVersion;
  /** If the current selected version is a live version, where not all properties are editable */
  versionIsLive: boolean;
  /** If the current selected version is the first version to be created */
  versionIsFirst: boolean;
  /** All version locales that should be, or are enabled */
  versionLocales: AppleUtils.AppStoreVersionLocalization[];
};

export class AppVersionTask extends AppleTask {
  private options: AppVersionOptions;

  public constructor(options: Partial<AppVersionOptions> = {}) {
    super();
    this.options = {
      platform: options.platform ?? Platform.IOS,
      editLive: options.editLive ?? false,
    };
  }

  public name = (): string => (this.options.editLive ? 'live app version' : 'editable app version');

  public async prepareAsync({ context }: TaskPrepareOptions): Promise<void> {
    const { version, versionIsFirst, versionIsLive } = await resolveVersionAsync(
      context.app,
      this.options
    );

    assert(version, 'Could not resolve a live or editable app version');

    context.version = version;
    context.versionIsFirst = versionIsFirst;
    context.versionIsLive = versionIsLive;
    context.versionLocales = await version.getLocalizationsAsync();
  }

  public async downloadAsync({ config, context }: TaskDownloadOptions): Promise<void> {
    assert(context.version, `App version not initialized, can't download version`);

    config.setVersion(context.version.attributes);
    config.setVersionRelease(context.version.attributes);

    for (const locale of context.versionLocales) {
      config.setVersionLocale(locale.attributes);
    }
  }

  public async uploadAsync({ config, context }: TaskUploadOptions): Promise<void> {
    assert(context.version, `App version not initialized, can't update version`);

    const version = config.getVersion();
    const release = config.getVersionRelease();
    if (!version && !release) {
      Log.log(chalk`{dim - Skipped version and release update, not configured}`);
    } else {
      const { versionString } = context.version.attributes;
      const description = [version && 'version', release && 'release']
        .filter(Boolean)
        .join(' and ');

      context.version = await logAsync(
        () => context.version.updateAsync({ ...version, ...release }),
        {
          pending: `Updating ${description} info for ${chalk.bold(versionString)}...`,
          success: `Updated ${description} info for ${chalk.bold(versionString)}`,
          failure: `Failed updating ${description} info for ${chalk.bold(versionString)}`,
        }
      );
    }

    const locales = config.getLocales();
    if (locales.length <= 0) {
      Log.log(chalk`{dim - Skipped localized version update, no locales configured}`);
    } else {
      for (const locale of locales) {
        const attributes = config.getVersionLocale(locale, context);
        if (!attributes) {
          continue;
        }

        const oldModel = context.versionLocales.find(model => model.attributes.locale === locale);
        await logAsync(
          async () => {
            return oldModel
              ? await oldModel.updateAsync(attributes)
              : await context.version.createLocalizationAsync({ ...attributes, locale });
          },
          {
            pending: `${oldModel ? 'Updating' : 'Creating'} localized version for ${chalk.bold(
              locale
            )}...`,
            success: `${oldModel ? 'Updated' : 'Created'} localized version for ${chalk.bold(
              locale
            )}`,
            failure: `Failed ${
              oldModel ? 'updating' : 'creating'
            } localized version for ${chalk.bold(locale)}`,
          }
        );
      }

      context.versionLocales = await context.version.getLocalizationsAsync();
    }
  }
}

/**
 * Resolve the AppStoreVersion instance, either from live or editable version.
 * This also checks if this is the first version, which disallow release notes.
 */
async function resolveVersionAsync(
  app: AppleUtils.App,
  { editLive, platform }: AppVersionOptions
): Promise<{
  version: AppleUtils.AppStoreVersion | null;
  versionIsLive: boolean;
  versionIsFirst: boolean;
}> {
  let version: AppleUtils.AppStoreVersion | null = null;
  let versionIsLive = false;

  if (editLive) {
    version = await app.getLiveAppStoreVersionAsync({ platform });
    versionIsLive = !!version;
  }

  if (!version) {
    version = await retryIfNullAsync(() => app.getEditAppStoreVersionAsync({ platform }));
  }

  const versions = await app.getAppStoreVersionsAsync({
    query: { limit: 2, filter: { platform } },
  });

  return {
    version,
    versionIsLive,
    versionIsFirst: versions.length === 1,
  };
}
