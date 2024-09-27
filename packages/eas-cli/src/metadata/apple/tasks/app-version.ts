import {
  App,
  AppStoreState,
  AppStoreVersion,
  AppStoreVersionLocalization,
  AppStoreVersionPhasedRelease,
  PhasedReleaseState,
  Platform,
} from '@expo/apple-utils';
import assert from 'assert';
import chalk from 'chalk';

import Log from '../../../log';
import { logAsync } from '../../utils/log';
import { retryIfNullAsync } from '../../utils/retry';
import { AppleTask, TaskDownloadOptions, TaskPrepareOptions, TaskUploadOptions } from '../task';

export type AppVersionOptions = {
  /** If we should use the live version of the app (if available - defaults to false) */
  editLive: boolean;
  /** The platform to use (defaults to IOS) */
  platform: Platform;
  /** A version to create or select, if defined in the store configuration */
  version: string | null;
};

export type AppVersionData = {
  /** The current selected app store version to update */
  version: AppStoreVersion;
  /** If the current selected version is a live version, where not all properties are editable */
  versionIsLive: boolean;
  /** If the current selected version is the first version to be created */
  versionIsFirst: boolean;
  /** All version locales that should be, or are enabled */
  versionLocales: AppStoreVersionLocalization[];
  /** The (existing) phased release configuration, when set */
  versionPhasedRelease: AppStoreVersionPhasedRelease | null;
};

export class AppVersionTask extends AppleTask {
  private readonly options: AppVersionOptions;

  public constructor(options: Partial<AppVersionOptions> = {}) {
    super();
    this.options = {
      platform: options.platform ?? Platform.IOS,
      editLive: options.editLive ?? false,
      version: options.version ?? null,
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
    context.versionPhasedRelease = await version.getPhasedReleaseAsync();
  }

  public async downloadAsync({ config, context }: TaskDownloadOptions): Promise<void> {
    assert(context.version, `App version not initialized, can't download version`);

    config.setVersion(context.version.attributes);
    config.setVersionReleaseType(context.version.attributes);
    config.setVersionReleasePhased(context.versionPhasedRelease?.attributes);

    for (const locale of context.versionLocales) {
      config.setVersionLocale(locale.attributes);
    }
  }

  public async uploadAsync({ config, context }: TaskUploadOptions): Promise<void> {
    const version = config.getVersion();

    if (!context.version && version?.versionString) {
      context.version = await logAsync(
        () => {
          return context.app.createVersionAsync({
            versionString: version.versionString!,
            platform: this.options.platform,
          });
        },
        {
          pending: `Creating new version ${chalk.bold(version.versionString)}...`,
          success: `Created new version ${chalk.bold(version.versionString)}`,
          failure: `Failed creating new version ${chalk.bold(version.versionString)}`,
        }
      );
    }

    assert(context.version, `App version not initialized, can't update version`);
    const { versionString } = context.version.attributes;

    const release = config.getVersionReleaseType();
    if (!version && !release) {
      Log.log(chalk`{dim - Skipped version and release update, not configured}`);
    } else {
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

    const phasedRelease = config.getVersionReleasePhased();
    if (!phasedRelease && shouldDeletePhasedRelease(context.versionPhasedRelease)) {
      // if phased release was enabled, but now disabled, we need to remove it
      await logAsync(() => context.versionPhasedRelease!.deleteAsync(), {
        pending: `Disabling phased release for ${chalk.bold(versionString)}...`,
        success: `Disabled phased release for ${chalk.bold(versionString)}`,
        failure: `Failed disabling phased release for ${chalk.bold(versionString)}`,
      });
      context.versionPhasedRelease = null;
    } else if (phasedRelease && !context.versionPhasedRelease) {
      // if phased release was not yet set, but now enabled, we need to create it
      context.versionPhasedRelease = await logAsync(
        () => context.version.createPhasedReleaseAsync({ state: phasedRelease.phasedReleaseState }),
        {
          pending: `Enabling phased release for ${chalk.bold(versionString)}...`,
          success: `Enabled phased release for ${chalk.bold(versionString)}`,
          failure: `Failed enabling phased release for ${chalk.bold(versionString)}`,
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
 * Resolve the AppStoreVersion instance, either from the store config, live, or editable version.
 * This also checks if this is the first version, which disallow release notes.
 */
async function resolveVersionAsync(
  app: App,
  { editLive, platform, version: versionString }: AppVersionOptions
): Promise<{
  version: AppStoreVersion | null;
  versionIsLive: boolean;
  versionIsFirst: boolean;
}> {
  let version: AppStoreVersion | null = null;
  let versionIsLive = false;

  if (versionString) {
    version = await findEditAppStoreVersionAsync(app, { platform, version: versionString });
    if (!version) {
      version = await createOrUpdateEditAppStoreVersionAsync(app, {
        platform,
        version: versionString,
      });
    }

    versionIsLive = version?.attributes.appStoreState === AppStoreState.READY_FOR_SALE;
  }

  if (!version && editLive) {
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

/**
 * Determine if we can, and should, delete the phased release instance.
 * This returns true if the instance exist, and has one of the states below:
 *   - PhasedReleaseState.INACTIVE
 *   - PhasedReleaseState.ACTIVE
 *   - PhasedReleaseState.PAUSED
 */
function shouldDeletePhasedRelease(phasedRelease: AppStoreVersionPhasedRelease | null): boolean {
  if (
    !phasedRelease ||
    phasedRelease.attributes.phasedReleaseState === PhasedReleaseState.COMPLETE
  ) {
    return false;
  }

  return true;
}

/*
 * Search for editable app store versions that matches the `versionString` option.
 * When nothing is found, it will return `null`, and a new version should be created.
 */
async function findEditAppStoreVersionAsync(
  app: App,
  options: { version: string; platform: Platform }
): Promise<AppStoreVersion | null> {
  if (options.version) {
    const versions = await app.getAppStoreVersionsAsync({
      query: {
        limit: 200,
        filter: {
          platform: options.platform,
          appStoreState: [
            AppStoreState.PREPARE_FOR_SUBMISSION,
            AppStoreState.DEVELOPER_REJECTED,
            AppStoreState.REJECTED,
            AppStoreState.METADATA_REJECTED,
            AppStoreState.WAITING_FOR_REVIEW,
            AppStoreState.INVALID_BINARY,
          ].join(','),
        },
      },
    });

    const version = versions.find(model => model.attributes.versionString === options.version);
    if (version) {
      return version;
    }
  }

  return null;
}

/**
 * Check if we can reuse an existing editable app version that has not been published yet.
 * If not, it creates a new version based on the version string.
 */
async function createOrUpdateEditAppStoreVersionAsync(
  app: App,
  options: { version: string; platform: Platform }
): Promise<AppStoreVersion> {
  const version = await app.getEditAppStoreVersionAsync({ platform: options.platform });

  if (version) {
    return await version.updateAsync({ versionString: options.version });
  }

  return await app.createVersionAsync({
    versionString: options.version,
    platform: options.platform,
  });
}
