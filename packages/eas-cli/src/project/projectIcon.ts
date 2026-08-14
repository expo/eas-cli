import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';

import { getPrivateExpoConfigAsync } from './expoConfig';
import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { AppUploadSessionType } from '../graphql/generated';
import { AppQuery } from '../graphql/queries/AppQuery';
import Log from '../log';
import { uploadAppScopedFileAtPathToGCSAsync } from '../uploads';
import { sleepAsync } from '../utils/promise';

const ALLOWED_EXTENSIONS = ['.png', '.jpg', '.jpeg'];
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // matches the upload session's GCS limit
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 90_000;

/** An icon found in the app config, with the field it came from for display purposes. */
export interface AppConfigIcon {
  field: string;
  path: string;
}

export type SetProjectIconFromAppConfigResult =
  | { status: 'set'; icon: AppConfigIcon }
  | {
      status: 'skipped';
      reason: 'no-icon-in-app-config' | 'icon-already-set' | 'invalid-icon' | 'upload-failed';
    };

/**
 * Set the project icon from the app config, but only when the project does not have one yet.
 * Overwriting an icon picked on the dashboard would be surprising, and the app config is not the
 * source of truth for it.
 *
 * Never throws. The project is already created or linked by the time this runs, so a failed icon
 * upload must not fail the command that called it.
 */
export async function maybeSetProjectIconFromAppConfigAsync(
  graphqlClient: ExpoGraphqlClient,
  { projectId, projectDir }: { projectId: string; projectDir: string }
): Promise<SetProjectIconFromAppConfigResult> {
  const icon = await resolveAppConfigIconAsync(projectDir);
  if (!icon) {
    return { status: 'skipped', reason: 'no-icon-in-app-config' };
  }

  try {
    await validateIconAsync(icon.path);
  } catch (error: any) {
    Log.warn(`Did not set the project icon from "${icon.field}": ${error.message}`);
    return { status: 'skipped', reason: 'invalid-icon' };
  }

  const existingIconUrl = await AppQuery.byIdProfileImageUrlAsync(graphqlClient, projectId);
  if (existingIconUrl) {
    Log.debug('The project already has an icon, skipping the icon from the app config.');
    return { status: 'skipped', reason: 'icon-already-set' };
  }

  try {
    await uploadProjectIconAsync(graphqlClient, { projectId, imagePath: icon.path });
  } catch (error: any) {
    Log.warn(`Failed to set the project icon from "${icon.field}": ${error.message}`);
    return { status: 'skipped', reason: 'upload-failed' };
  }

  // The server resizes the image and assigns it to the project asynchronously. Callers that need
  // the icon to be visible before they return should poll with pollForProfileImageChangeAsync.
  Log.withTick(`Set the project icon from ${chalk.bold(icon.field)} in your app config`);
  return { status: 'set', icon };
}

/**
 * Find the app icon on disk. Falls through to the platform-specific icons so that a project that
 * only sets `ios.icon` or an Android adaptive icon still gets one.
 */
export async function resolveAppConfigIconAsync(projectDir: string): Promise<AppConfigIcon | null> {
  let exp;
  try {
    exp = await getPrivateExpoConfigAsync(projectDir);
  } catch (error: any) {
    Log.debug(`Could not read the app config to resolve the project icon: ${error.message}`);
    return null;
  }

  const candidates: [string, unknown][] = [
    ['icon', exp.icon],
    ['ios.icon', exp.ios?.icon],
    ['android.adaptiveIcon.foregroundImage', exp.android?.adaptiveIcon?.foregroundImage],
  ];

  for (const [field, value] of candidates) {
    const iconPath = resolveLocalIconPath(projectDir, value);
    if (iconPath && (await fs.pathExists(iconPath))) {
      return { field, path: iconPath };
    }
  }

  return null;
}

function resolveLocalIconPath(projectDir: string, value: unknown): string | null {
  // SDK 52 and above allow `ios.icon` to be a per-appearance map. The light icon is the one shown
  // in most places, so it is the closest match for a single project icon.
  let rawPath: string | null = null;
  if (typeof value === 'string') {
    rawPath = value;
  } else if (value && typeof value === 'object' && typeof (value as any).light === 'string') {
    rawPath = (value as any).light;
  }

  // Remote icons (http://, https://, data:) are not files we can upload. The scheme must be at
  // least two characters so that a Windows drive letter is still treated as a path.
  if (!rawPath || /^[a-z][a-z0-9+.-]+:/i.test(rawPath)) {
    return null;
  }

  return path.resolve(projectDir, rawPath);
}

export async function validateIconAsync(imagePath: string): Promise<void> {
  if (!(await fs.pathExists(imagePath))) {
    throw new Error(`No file found at ${imagePath}`);
  }
  const extension = path.extname(imagePath).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(extension)) {
    throw new Error(
      `Unsupported image format "${extension}". The icon must be a PNG or JPEG file.`
    );
  }
  const { size } = await fs.stat(imagePath);
  if (size > MAX_IMAGE_SIZE_BYTES) {
    throw new Error(
      `The image is ${(size / 1024 / 1024).toFixed(1)} MB, but the maximum allowed size is 10 MB.`
    );
  }
}

export async function uploadProjectIconAsync(
  graphqlClient: ExpoGraphqlClient,
  { projectId, imagePath }: { projectId: string; imagePath: string }
): Promise<void> {
  await uploadAppScopedFileAtPathToGCSAsync(graphqlClient, {
    type: AppUploadSessionType.ProfileImageUpload,
    appId: projectId,
    path: imagePath,
  });
}

export async function pollForProfileImageChangeAsync(
  graphqlClient: ExpoGraphqlClient,
  {
    projectId,
    previousProfileImageUrl,
    projectDashboardUrl,
  }: {
    projectId: string;
    previousProfileImageUrl: string | null;
    projectDashboardUrl: string;
  }
): Promise<void> {
  const startTime = Date.now();
  while (Date.now() - startTime < POLL_TIMEOUT_MS) {
    await sleepAsync(POLL_INTERVAL_MS);
    const profileImageUrl = await AppQuery.byIdProfileImageUrlAsync(graphqlClient, projectId);
    if (profileImageUrl && profileImageUrl !== previousProfileImageUrl) {
      return;
    }
  }
  throw new Error(
    `Timed out waiting for the icon to be processed. It may still appear on the project page shortly: ${chalk.underline(
      projectDashboardUrl
    )}`
  );
}
