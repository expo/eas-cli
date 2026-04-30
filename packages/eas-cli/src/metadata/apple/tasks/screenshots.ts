import {
  AppScreenshot,
  AppScreenshotSet,
  AppStoreVersionLocalization,
  ScreenshotDisplayType,
} from '@expo/apple-utils';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';

import fetch from '../../../fetch';
import Log from '../../../log';
import { logAsync } from '../../utils/log';
import { AppleTask, TaskDownloadOptions, TaskPrepareOptions, TaskUploadOptions } from '../task';
import { AppleScreenshots } from '../types';

/** Locale -> ScreenshotDisplayType -> AppScreenshotSet */
export type ScreenshotSetsMap = Map<string, Map<ScreenshotDisplayType, AppScreenshotSet>>;

export type ScreenshotsData = {
  /** Map of locales to their screenshot sets */
  screenshotSets: ScreenshotSetsMap;
};

/**
 * Task for managing App Store screenshots.
 * Downloads existing screenshots and uploads new ones based on store configuration.
 */
export class ScreenshotsTask extends AppleTask {
  public name = (): string => 'screenshots';

  public async prepareAsync({ context }: TaskPrepareOptions): Promise<void> {
    // Initialize the screenshot sets map
    context.screenshotSets = new Map();

    if (!context.versionLocales) {
      return;
    }

    // Fetch screenshot sets for all locales in parallel
    await Promise.all(
      context.versionLocales.map(async locale => {
        const sets = await locale.getAppScreenshotSetsAsync();
        const displayTypeMap = new Map<ScreenshotDisplayType, AppScreenshotSet>();

        for (const set of sets) {
          displayTypeMap.set(set.attributes.screenshotDisplayType, set);
        }

        context.screenshotSets!.set(locale.attributes.locale, displayTypeMap);
      })
    );
  }

  public async downloadAsync({ config, context }: TaskDownloadOptions): Promise<void> {
    if (!context.screenshotSets || !context.versionLocales) {
      return;
    }

    for (const locale of context.versionLocales) {
      const localeCode = locale.attributes.locale;
      const displayTypeMap = context.screenshotSets.get(localeCode);

      if (!displayTypeMap || displayTypeMap.size === 0) {
        continue;
      }

      const screenshots: AppleScreenshots = {};

      for (const [displayType, set] of displayTypeMap) {
        const screenshotModels = set.attributes.appScreenshots;
        if (!screenshotModels || screenshotModels.length === 0) {
          continue;
        }

        // Download screenshots and save to local filesystem. When a screenshot
        // is in a broken state (AWAITING_UPLOAD with no rendered imageAsset)
        // the download will fail, but we still preserve the entry pointing at
        // its expected local path so users can either drop in a replacement
        // file or remove the entry to delete the broken ASC record.
        const paths: string[] = [];
        for (let i = 0; i < screenshotModels.length; i++) {
          const screenshot = screenshotModels[i];
          const downloaded = await downloadScreenshotAsync(
            context.projectDir,
            localeCode,
            displayType,
            screenshot,
            i
          );
          if (downloaded) {
            paths.push(downloaded);
            continue;
          }
          // Fall back to a placeholder path so the entry isn't lost from
          // config. Push will detect that the existing screenshot isn't
          // complete and either re-upload (if a local file exists at this
          // path) or warn and skip (if it doesn't).
          const fileName =
            screenshot.attributes.fileName || `${String(i + 1).padStart(2, '0')}.png`;
          paths.push(path.join('store', 'apple', 'screenshot', localeCode, displayType, fileName));
        }

        if (paths.length > 0) {
          screenshots[displayType] = paths;
        }
      }

      if (Object.keys(screenshots).length > 0) {
        config.setScreenshots(localeCode, screenshots);
      }
    }
  }

  public async uploadAsync({ config, context }: TaskUploadOptions): Promise<void> {
    if (!context.screenshotSets || !context.versionLocales) {
      Log.log(chalk`{dim - Skipped screenshots, no version available}`);
      return;
    }

    const locales = config.getLocales();
    if (locales.length <= 0) {
      Log.log(chalk`{dim - Skipped screenshots, no locales configured}`);
      return;
    }

    for (const localeCode of locales) {
      const screenshots = config.getScreenshots(localeCode);
      if (!screenshots || Object.keys(screenshots).length === 0) {
        continue;
      }

      const localization = context.versionLocales.find(l => l.attributes.locale === localeCode);
      if (!localization) {
        Log.warn(chalk`{yellow Skipping screenshots for ${localeCode} - locale not found}`);
        continue;
      }

      for (const [displayType, paths] of Object.entries(screenshots)) {
        if (!paths || paths.length === 0) {
          continue;
        }

        await syncScreenshotSetAsync(
          context.projectDir,
          localization,
          displayType as ScreenshotDisplayType,
          paths,
          context.screenshotSets.get(localeCode)
        );
      }
    }
  }
}

/**
 * Sync a screenshot set - upload new screenshots, delete removed ones, reorder if needed.
 */
async function syncScreenshotSetAsync(
  projectDir: string,
  localization: AppStoreVersionLocalization,
  displayType: ScreenshotDisplayType,
  paths: string[],
  existingSets: Map<ScreenshotDisplayType, AppScreenshotSet> | undefined
): Promise<void> {
  const locale = localization.attributes.locale;

  // Get or create the screenshot set
  let screenshotSet = existingSets?.get(displayType);

  if (!screenshotSet) {
    screenshotSet = await logAsync(
      () =>
        localization.createAppScreenshotSetAsync({
          screenshotDisplayType: displayType,
        }),
      {
        pending: `Creating screenshot set for ${chalk.bold(displayType)} (${locale})...`,
        success: `Created screenshot set for ${chalk.bold(displayType)} (${locale})`,
        failure: `Failed creating screenshot set for ${chalk.bold(displayType)} (${locale})`,
      }
    );
  }

  const existingScreenshots = screenshotSet.attributes.appScreenshots || [];

  // Build a map of existing screenshots by filename for comparison
  const existingByFilename = new Map<string, AppScreenshot>();
  for (const screenshot of existingScreenshots) {
    existingByFilename.set(screenshot.attributes.fileName, screenshot);
  }

  // Track which screenshots to keep, upload, and delete
  const screenshotIdsToKeep: string[] = [];
  const pathsToUpload: string[] = [];

  for (const relativePath of paths) {
    const absolutePath = path.resolve(projectDir, relativePath);
    const fileName = path.basename(absolutePath);

    // Check if screenshot already exists with same name and file size
    const existing = existingByFilename.get(fileName);
    const localSize = fs.existsSync(absolutePath) ? fs.statSync(absolutePath).size : null;
    if (
      existing &&
      existing.isComplete() &&
      (localSize === null || existing.attributes.fileSize === localSize)
    ) {
      screenshotIdsToKeep.push(existing.id);
      existingByFilename.delete(fileName);
    } else {
      pathsToUpload.push(absolutePath);
    }
  }

  // Delete screenshots that are no longer in config
  for (const screenshot of existingByFilename.values()) {
    await logAsync(() => screenshot.deleteAsync(), {
      pending: `Deleting screenshot ${chalk.bold(screenshot.attributes.fileName)} (${locale})...`,
      success: `Deleted screenshot ${chalk.bold(screenshot.attributes.fileName)} (${locale})`,
      failure: `Failed deleting screenshot ${chalk.bold(screenshot.attributes.fileName)} (${locale})`,
    });
  }

  // Upload new screenshots
  for (const absolutePath of pathsToUpload) {
    const fileName = path.basename(absolutePath);

    if (!fs.existsSync(absolutePath)) {
      Log.warn(chalk`{yellow Screenshot not found: ${absolutePath}}`);
      continue;
    }

    const newScreenshot = await logAsync(
      () =>
        AppScreenshot.uploadAsync(localization.context, {
          id: screenshotSet!.id,
          filePath: absolutePath,
          waitForProcessing: true,
        }),
      {
        pending: `Uploading screenshot ${chalk.bold(fileName)} (${locale})...`,
        success: `Uploaded screenshot ${chalk.bold(fileName)} (${locale})`,
        failure: `Failed uploading screenshot ${chalk.bold(fileName)} (${locale})`,
      }
    );

    screenshotIdsToKeep.push(newScreenshot.id);
  }

  // Reorder screenshots to match config order
  if (screenshotIdsToKeep.length > 0) {
    const refreshedSet = await AppScreenshotSet.infoAsync(localization.context, {
      id: screenshotSet.id,
    });
    const refreshedScreenshots = refreshedSet.attributes.appScreenshots || [];
    const screenshotsByFilename = new Map<string, AppScreenshot>();
    for (const s of refreshedScreenshots) {
      screenshotsByFilename.set(s.attributes.fileName, s);
    }

    // Build the desired order based on config paths
    const orderedIds: string[] = [];
    for (const relativePath of paths) {
      const fileName = path.basename(relativePath);
      const screenshot = screenshotsByFilename.get(fileName);
      if (screenshot) {
        orderedIds.push(screenshot.id);
      }
    }

    // Only call reorder if the order actually differs from current
    const currentIds = refreshedScreenshots.map(s => s.id);
    if (
      orderedIds.length > 0 &&
      (orderedIds.length !== currentIds.length || orderedIds.some((id, i) => id !== currentIds[i]))
    ) {
      await screenshotSet.reorderScreenshotsAsync({ appScreenshots: orderedIds });
    }
  }
}

/**
 * Download a screenshot to the local filesystem.
 * Returns the relative path to the downloaded file.
 */
async function downloadScreenshotAsync(
  projectDir: string,
  locale: string,
  displayType: ScreenshotDisplayType,
  screenshot: AppScreenshot,
  index: number
): Promise<string | null> {
  const imageUrl = screenshot.getImageAssetUrl({ type: 'png' });
  if (!imageUrl) {
    Log.warn(
      chalk`{yellow Could not get download URL for screenshot ${screenshot.attributes.fileName}}`
    );
    return null;
  }

  // Create directory structure: store/apple/screenshot/{locale}/{displayType}/
  const screenshotsDir = path.join(projectDir, 'store', 'apple', 'screenshot', locale, displayType);
  await fs.promises.mkdir(screenshotsDir, { recursive: true });

  // Use original filename for matching during sync
  const fileName = screenshot.attributes.fileName || `${String(index + 1).padStart(2, '0')}.png`;
  const outputPath = path.join(screenshotsDir, fileName);
  const relativePath = path.relative(projectDir, outputPath);

  try {
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const buffer = await response.buffer();
    await fs.promises.writeFile(outputPath, buffer);

    Log.log(chalk`{dim Downloaded screenshot: ${relativePath}}`);
    return relativePath;
  } catch (error: any) {
    Log.warn(chalk`{yellow Failed to download screenshot ${fileName}: ${error.message}}`);
    return null;
  }
}
