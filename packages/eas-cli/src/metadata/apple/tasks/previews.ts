import {
  AppPreview,
  AppPreviewSet,
  AppStoreVersionLocalization,
  PreviewType,
} from '@expo/apple-utils';
import chalk from 'chalk';
import fs from 'fs';
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

/** Normalized preview entry used internally by the upload pipeline. */
type NormalizedPreviewConfig = {
  path: string;
  previewFrameTimeCode?: string;
};

/**
 * Normalize a single preview config into an object form with path and optional previewFrameTimeCode.
 */
function normalizePreviewConfig(config: ApplePreviewConfig): NormalizedPreviewConfig {
  if (typeof config === 'string') {
    return { path: config };
  }
  return config;
}

/**
 * Normalize the value stored in `ApplePreviews[previewType]` (which can be a single
 * config OR an array of configs) into an array of normalized configs.
 */
function normalizePreviewConfigs(
  value: ApplePreviewConfig | ApplePreviewConfig[]
): NormalizedPreviewConfig[] {
  if (Array.isArray(value)) {
    return value.map(normalizePreviewConfig);
  }
  return [normalizePreviewConfig(value)];
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

    // Fetch preview sets for all locales in parallel
    await Promise.all(
      context.versionLocales.map(async locale => {
        const sets = await locale.getAppPreviewSetsAsync();
        const previewTypeMap = new Map<PreviewType, AppPreviewSet>();

        for (const set of sets) {
          previewTypeMap.set(set.attributes.previewType, set);
        }

        context.previewSets!.set(locale.attributes.locale, previewTypeMap);
      })
    );
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

        // Download all previews in this set, preserving order. Mirrors how
        // screenshots are handled: when a preview is in a broken state
        // (AWAITING_UPLOAD with no rendered videoUrl) the download will fail,
        // but we still preserve the entry pointing at its expected local path
        // so users can either drop in a replacement file or remove the entry
        // to delete the broken ASC record.
        const entries: ApplePreviewConfig[] = [];
        for (let i = 0; i < previewModels.length; i++) {
          const preview = previewModels[i];
          const downloaded = await downloadPreviewAsync(
            context.projectDir,
            localeCode,
            previewType,
            preview,
            i
          );

          const fileName = preview.attributes.fileName || `${String(i + 1).padStart(2, '0')}.mp4`;
          const relativePath =
            downloaded || path.join('store', 'apple', 'preview', localeCode, previewType, fileName);

          if (preview.attributes.previewFrameTimeCode) {
            entries.push({
              path: relativePath,
              previewFrameTimeCode: preview.attributes.previewFrameTimeCode,
            });
          } else {
            entries.push(relativePath);
          }
        }

        if (entries.length === 0) {
          continue;
        }

        // For backwards compatibility with existing single-preview configs,
        // emit the legacy single-object form when there's exactly one entry.
        previews[previewType] = entries.length === 1 ? entries[0] : entries;
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

      for (const [previewType, previewValue] of Object.entries(previews)) {
        if (!previewValue) {
          continue;
        }

        const normalized = normalizePreviewConfigs(previewValue);
        if (normalized.length === 0) {
          continue;
        }

        await syncPreviewSetAsync(
          context.projectDir,
          localization,
          previewType as PreviewType,
          normalized,
          context.previewSets.get(localeCode)
        );
      }
    }
  }
}

/**
 * Sync a preview set against the configured previews.
 *
 * Mirrors the screenshots task: keeps unchanged previews (matched by filename
 * + size + completion state), uploads any new/changed previews, deletes
 * removed entries, and finally reorders the set to match config order.
 */
async function syncPreviewSetAsync(
  projectDir: string,
  localization: AppStoreVersionLocalization,
  previewType: PreviewType,
  previewConfigs: NormalizedPreviewConfig[],
  existingSets: Map<PreviewType, AppPreviewSet> | undefined
): Promise<void> {
  const locale = localization.attributes.locale;

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

  // Build a map of existing previews by filename for comparison.
  const existingByFilename = new Map<string, AppPreview>();
  for (const preview of existingPreviews) {
    existingByFilename.set(preview.attributes.fileName, preview);
  }

  // Track which previews to keep (by id), and which configs need uploading.
  const keptPreviewIds = new Set<string>();
  type UploadEntry = {
    absolutePath: string;
    fileName: string;
    previewFrameTimeCode?: string;
  };
  const toUpload: UploadEntry[] = [];

  for (const previewConfig of previewConfigs) {
    const absolutePath = path.resolve(projectDir, previewConfig.path);
    const fileName = path.basename(absolutePath);

    const existing = existingByFilename.get(fileName);
    const localSize = fs.existsSync(absolutePath) ? fs.statSync(absolutePath).size : null;

    if (
      existing &&
      existing.isComplete() &&
      (localSize === null || existing.attributes.fileSize === localSize)
    ) {
      keptPreviewIds.add(existing.id);
      existingByFilename.delete(fileName);

      // If only the previewFrameTimeCode changed, patch it in place.
      if (
        previewConfig.previewFrameTimeCode &&
        existing.attributes.previewFrameTimeCode !== previewConfig.previewFrameTimeCode
      ) {
        await logAsync(
          () =>
            existing.updateAsync({
              previewFrameTimeCode: previewConfig.previewFrameTimeCode,
            }),
          {
            pending: `Updating preview frame time code for ${chalk.bold(fileName)} (${locale})...`,
            success: `Updated preview frame time code for ${chalk.bold(fileName)} (${locale})`,
            failure: `Failed updating preview frame time code for ${chalk.bold(fileName)} (${locale})`,
          }
        );
      } else {
        Log.log(chalk`{dim Preview ${fileName} already exists, skipping upload}`);
      }
      continue;
    }

    toUpload.push({
      absolutePath,
      fileName,
      previewFrameTimeCode: previewConfig.previewFrameTimeCode,
    });
  }

  // Delete previews that are no longer in config.
  for (const preview of existingByFilename.values()) {
    await logAsync(() => preview.deleteAsync(), {
      pending: `Deleting old preview ${chalk.bold(preview.attributes.fileName)} (${locale})...`,
      success: `Deleted old preview ${chalk.bold(preview.attributes.fileName)} (${locale})`,
      failure: `Failed deleting old preview ${chalk.bold(preview.attributes.fileName)} (${locale})`,
    });
  }

  // Upload new previews.
  for (const entry of toUpload) {
    if (!fs.existsSync(entry.absolutePath)) {
      Log.warn(chalk`{yellow Video preview not found: ${entry.absolutePath}}`);
      continue;
    }

    const newPreview = await logAsync(
      () =>
        AppPreview.uploadAsync(localization.context, {
          id: previewSet!.id,
          filePath: entry.absolutePath,
          waitForProcessing: true,
          previewFrameTimeCode: entry.previewFrameTimeCode,
        }),
      {
        pending: `Uploading video preview ${chalk.bold(entry.fileName)} (${locale})...`,
        success: `Uploaded video preview ${chalk.bold(entry.fileName)} (${locale})`,
        failure: `Failed uploading video preview ${chalk.bold(entry.fileName)} (${locale})`,
      }
    );

    keptPreviewIds.add(newPreview.id);
  }

  // Reorder previews to match config order (mirrors screenshots).
  if (keptPreviewIds.size > 0) {
    const refreshedSet = await AppPreviewSet.infoAsync(localization.context, {
      id: previewSet.id,
    });
    const refreshedPreviews = refreshedSet.attributes.appPreviews || [];
    const previewsByFilename = new Map<string, AppPreview>();
    for (const p of refreshedPreviews) {
      previewsByFilename.set(p.attributes.fileName, p);
    }

    const orderedIds: string[] = [];
    for (const previewConfig of previewConfigs) {
      const fileName = path.basename(previewConfig.path);
      const preview = previewsByFilename.get(fileName);
      if (preview) {
        orderedIds.push(preview.id);
      }
    }

    const currentIds = refreshedPreviews.map(p => p.id);
    if (
      orderedIds.length > 0 &&
      (orderedIds.length !== currentIds.length || orderedIds.some((id, i) => id !== currentIds[i]))
    ) {
      await previewSet.reorderPreviewsAsync({ appPreviews: orderedIds });
    }
  }
}

/**
 * Download a video preview to the local filesystem.
 * Returns the relative path to the downloaded file.
 */
async function downloadPreviewAsync(
  projectDir: string,
  locale: string,
  previewType: PreviewType,
  preview: AppPreview,
  index: number
): Promise<string | null> {
  const videoUrl = preview.getVideoUrl();
  if (!videoUrl) {
    Log.warn(chalk`{yellow Could not get download URL for preview ${preview.attributes.fileName}}`);
    return null;
  }

  // Create directory structure: store/apple/preview/{locale}/{previewType}/
  const previewsDir = path.join(projectDir, 'store', 'apple', 'preview', locale, previewType);
  await fs.promises.mkdir(previewsDir, { recursive: true });

  // Use original filename for matching during sync
  const fileName = preview.attributes.fileName || `${String(index + 1).padStart(2, '0')}.mp4`;
  const outputPath = path.join(previewsDir, fileName);
  const relativePath = path.relative(projectDir, outputPath);

  try {
    const response = await fetch(videoUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const buffer = await response.buffer();
    await fs.promises.writeFile(outputPath, buffer);

    Log.log(chalk`{dim Downloaded video preview: ${relativePath}}`);
    return relativePath;
  } catch (error: any) {
    Log.warn(chalk`{yellow Failed to download video preview ${fileName}: ${error.message}}`);
    return null;
  }
}
