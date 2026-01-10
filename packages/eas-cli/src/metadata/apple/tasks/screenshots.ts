import {
  AppScreenshot,
  AppScreenshotSet,
  AppStoreVersionLocalization,
  ScreenshotDisplayType,
} from '@expo/apple-utils';
import assert from 'assert';
import chalk from 'chalk';
import fs from 'fs-extra';
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

    // Fetch screenshot sets for each locale
    for (const locale of context.versionLocales) {
      const sets = await locale.getAppScreenshotSetsAsync();
      const displayTypeMap = new Map<ScreenshotDisplayType, AppScreenshotSet>();

      for (const set of sets) {
        displayTypeMap.set(set.attributes.screenshotDisplayType, set);
      }

      context.screenshotSets.set(locale.attributes.locale, displayTypeMap);
    }
  }

  public async downloadAsync({ config, context }: TaskDownloadOptions): Promise<void> {
    assert(context.screenshotSets, `Screenshot sets not initialized, can't download screenshots`);

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

        // Download screenshots and save to local filesystem
        const paths: string[] = [];
        for (let i = 0; i < screenshotModels.length; i++) {
          const screenshot = screenshotModels[i];
          const relativePath = await downloadScreenshotAsync(
            context.projectDir,
            localeCode,
            displayType,
            screenshot,
            i
          );
          if (relativePath) {
            paths.push(relativePath);
          }
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
    assert(context.screenshotSets, `Screenshot sets not initialized, can't upload screenshots`);

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

    // Check if screenshot already exists
    const existing = existingByFilename.get(fileName);
    if (existing && existing.isComplete()) {
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

    if (!(await fs.pathExists(absolutePath))) {
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
    // Build the correct order based on config paths
    const orderedIds: string[] = [];
    const refreshedSet = await AppScreenshotSet.infoAsync(localization.context, {
      id: screenshotSet.id,
    });
    const refreshedScreenshots = refreshedSet.attributes.appScreenshots || [];
    const screenshotsByFilename = new Map<string, AppScreenshot>();
    for (const s of refreshedScreenshots) {
      screenshotsByFilename.set(s.attributes.fileName, s);
    }

    for (const relativePath of paths) {
      const fileName = path.basename(relativePath);
      const screenshot = screenshotsByFilename.get(fileName);
      if (screenshot) {
        orderedIds.push(screenshot.id);
      }
    }

    if (orderedIds.length > 0) {
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
  const displayTypeDir = displayType.toLowerCase().replace(/_/g, '-');
  const screenshotsDir = path.join(
    projectDir,
    'store',
    'apple',
    'screenshot',
    locale,
    displayTypeDir
  );
  await fs.ensureDir(screenshotsDir);

  // Use normalized index-based filename: 01.png, 02.png, etc.
  const ext = (path.extname(screenshot.attributes.fileName || '.png') || '.png').toLowerCase();
  const fileName = `${String(index + 1).padStart(2, '0')}${ext}`;
  const outputPath = path.join(screenshotsDir, fileName);
  const relativePath = path.relative(projectDir, outputPath);

  try {
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const buffer = await response.buffer();
    await fs.writeFile(outputPath, buffer);

    Log.log(chalk`{dim Downloaded screenshot: ${relativePath}}`);
    return relativePath;
  } catch (error: any) {
    Log.warn(chalk`{yellow Failed to download screenshot ${fileName}: ${error.message}}`);
    return null;
  }
}
