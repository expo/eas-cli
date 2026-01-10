import {
  AppPreview,
  AppPreviewSet,
  AppStoreVersionLocalization,
  PreviewType,
} from '@expo/apple-utils';
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';

import fetch from '../../../fetch';
import Log from '../../../log';
import { logAsync } from '../../utils/log';
import { AppleTask, TaskDownloadOptions, TaskPrepareOptions, TaskUploadOptions } from '../task';
import { ApplePreviewConfig, ApplePreviews } from '../types';

/** Locale -> PreviewType -> AppPreviewSet */
export type PreviewSetsMap = Map<string, Map<PreviewType, AppPreviewSet>>;

export type PreviewsData = {
  /** Map of locales to their preview sets */
  previewSets: PreviewSetsMap;
};

/**
 * Normalize preview config to always return an object with path and optional previewFrameTimeCode.
 */
function normalizePreviewConfig(config: ApplePreviewConfig): {
  path: string;
  previewFrameTimeCode?: string;
} {
  if (typeof config === 'string') {
    return { path: config };
  }
  return config;
}

/**
 * Task for managing App Store video previews.
 * Downloads existing previews and uploads new ones based on store configuration.
 */
export class PreviewsTask extends AppleTask {
  public name = (): string => 'video previews';

  public async prepareAsync({ context }: TaskPrepareOptions): Promise<void> {
    // Initialize the preview sets map
    context.previewSets = new Map();

    if (!context.versionLocales) {
      return;
    }

    // Fetch preview sets for each locale
    for (const locale of context.versionLocales) {
      // Check if the method exists - @expo/apple-utils may not have implemented preview support yet
      if (typeof locale.getAppPreviewSetsAsync !== 'function') {
        Log.warn(
          'Video preview support requires a newer version of @expo/apple-utils. Skipping previews.'
        );
        return;
      }

      const sets = await locale.getAppPreviewSetsAsync();
      const previewTypeMap = new Map<PreviewType, AppPreviewSet>();

      for (const set of sets) {
        previewTypeMap.set(set.attributes.previewType, set);
      }

      context.previewSets.set(locale.attributes.locale, previewTypeMap);
    }
  }

  public async downloadAsync({ config, context }: TaskDownloadOptions): Promise<void> {
    if (!context.previewSets || !context.versionLocales) {
      return;
    }

    for (const locale of context.versionLocales) {
      const localeCode = locale.attributes.locale;
      const previewTypeMap = context.previewSets.get(localeCode);

      if (!previewTypeMap || previewTypeMap.size === 0) {
        continue;
      }

      const previews: ApplePreviews = {};

      for (const [previewType, set] of previewTypeMap) {
        const previewModels = set.attributes.appPreviews;
        if (!previewModels || previewModels.length === 0) {
          continue;
        }

        // For now, we only handle the first preview per set (App Store allows up to 3)
        // We can extend this later to support multiple previews
        const preview = previewModels[0];
        const relativePath = await downloadPreviewAsync(
          context.projectDir,
          localeCode,
          previewType,
          preview
        );

        if (relativePath) {
          // Include preview frame time code if available
          if (preview.attributes.previewFrameTimeCode) {
            previews[previewType] = {
              path: relativePath,
              previewFrameTimeCode: preview.attributes.previewFrameTimeCode,
            };
          } else {
            previews[previewType] = relativePath;
          }
        }
      }

      if (Object.keys(previews).length > 0) {
        config.setPreviews(localeCode, previews);
      }
    }
  }

  public async uploadAsync({ config, context }: TaskUploadOptions): Promise<void> {
    if (!context.previewSets || !context.versionLocales) {
      Log.log(chalk`{dim - Skipped video previews, no version available}`);
      return;
    }

    const locales = config.getLocales();
    if (locales.length <= 0) {
      Log.log(chalk`{dim - Skipped video previews, no locales configured}`);
      return;
    }

    for (const localeCode of locales) {
      const previews = config.getPreviews(localeCode);
      if (!previews || Object.keys(previews).length === 0) {
        continue;
      }

      const localization = context.versionLocales.find(l => l.attributes.locale === localeCode);
      if (!localization) {
        Log.warn(chalk`{yellow Skipping video previews for ${localeCode} - locale not found}`);
        continue;
      }

      for (const [previewType, previewConfig] of Object.entries(previews)) {
        if (!previewConfig) {
          continue;
        }

        await syncPreviewSetAsync(
          context.projectDir,
          localization,
          previewType as PreviewType,
          normalizePreviewConfig(previewConfig),
          context.previewSets.get(localeCode)
        );
      }
    }
  }
}

/**
 * Sync a preview set - upload new preview, delete old one if changed.
 */
async function syncPreviewSetAsync(
  projectDir: string,
  localization: AppStoreVersionLocalization,
  previewType: PreviewType,
  previewConfig: { path: string; previewFrameTimeCode?: string },
  existingSets: Map<PreviewType, AppPreviewSet> | undefined
): Promise<void> {
  const locale = localization.attributes.locale;
  const absolutePath = path.resolve(projectDir, previewConfig.path);
  const fileName = path.basename(absolutePath);

  if (!(await fs.pathExists(absolutePath))) {
    Log.warn(chalk`{yellow Video preview not found: ${absolutePath}}`);
    return;
  }

  // Get or create the preview set
  let previewSet = existingSets?.get(previewType);

  if (!previewSet) {
    previewSet = await logAsync(
      () =>
        localization.createAppPreviewSetAsync({
          previewType,
        }),
      {
        pending: `Creating preview set for ${chalk.bold(previewType)} (${locale})...`,
        success: `Created preview set for ${chalk.bold(previewType)} (${locale})`,
        failure: `Failed creating preview set for ${chalk.bold(previewType)} (${locale})`,
      }
    );
  }

  const existingPreviews = previewSet.attributes.appPreviews || [];

  // Check if we need to update (different filename or no existing preview)
  const existingPreview = existingPreviews.find(p => p.attributes.fileName === fileName);

  if (existingPreview && existingPreview.isComplete()) {
    // Preview with same filename exists, check if we need to update preview frame time code
    if (
      previewConfig.previewFrameTimeCode &&
      existingPreview.attributes.previewFrameTimeCode !== previewConfig.previewFrameTimeCode
    ) {
      await logAsync(
        () =>
          existingPreview.updateAsync({
            previewFrameTimeCode: previewConfig.previewFrameTimeCode,
          }),
        {
          pending: `Updating preview frame time code for ${chalk.bold(fileName)} (${locale})...`,
          success: `Updated preview frame time code for ${chalk.bold(fileName)} (${locale})`,
          failure: `Failed updating preview frame time code for ${chalk.bold(fileName)} (${locale})`,
        }
      );
    }
    Log.log(chalk`{dim Preview ${fileName} already exists, skipping upload}`);
    return;
  }

  // Delete existing previews that don't match
  for (const preview of existingPreviews) {
    if (preview.attributes.fileName !== fileName) {
      await logAsync(() => preview.deleteAsync(), {
        pending: `Deleting old preview ${chalk.bold(preview.attributes.fileName)} (${locale})...`,
        success: `Deleted old preview ${chalk.bold(preview.attributes.fileName)} (${locale})`,
        failure: `Failed deleting old preview ${chalk.bold(preview.attributes.fileName)} (${locale})`,
      });
    }
  }

  // Upload new preview
  await logAsync(
    () =>
      AppPreview.uploadAsync(localization.context, {
        id: previewSet!.id,
        filePath: absolutePath,
        waitForProcessing: true,
        previewFrameTimeCode: previewConfig.previewFrameTimeCode,
      }),
    {
      pending: `Uploading video preview ${chalk.bold(fileName)} (${locale})...`,
      success: `Uploaded video preview ${chalk.bold(fileName)} (${locale})`,
      failure: `Failed uploading video preview ${chalk.bold(fileName)} (${locale})`,
    }
  );
}

/**
 * Download a video preview to the local filesystem.
 * Returns the relative path to the downloaded file.
 */
async function downloadPreviewAsync(
  projectDir: string,
  locale: string,
  previewType: PreviewType,
  preview: AppPreview
): Promise<string | null> {
  const videoUrl = preview.getVideoUrl();
  if (!videoUrl) {
    Log.warn(
      chalk`{yellow Could not get download URL for preview ${preview.attributes.fileName}}`
    );
    return null;
  }

  // Create directory structure: store/apple/preview/{locale}/{previewType}/
  const previewsDir = path.join(projectDir, 'store', 'apple', 'preview', locale, previewType);
  await fs.ensureDir(previewsDir);

  // Use normalized filename: 01.mp4, 01.mov, etc.
  const ext = (path.extname(preview.attributes.fileName || '.mp4') || '.mp4').toLowerCase();
  const fileName = `01${ext}`;
  const outputPath = path.join(previewsDir, fileName);
  const relativePath = path.relative(projectDir, outputPath);

  try {
    const response = await fetch(videoUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const buffer = await response.buffer();
    await fs.writeFile(outputPath, buffer);

    Log.log(chalk`{dim Downloaded video preview: ${relativePath}}`);
    return relativePath;
  } catch (error: any) {
    Log.warn(chalk`{yellow Failed to download video preview ${fileName}: ${error.message}}`);
    return null;
  }
}
