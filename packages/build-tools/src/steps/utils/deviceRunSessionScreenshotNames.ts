import type { bunyan } from '@expo/logger';
import { BuildRuntimePlatform } from '@expo/steps';

import type { CustomBuildContext } from '../../customBuildContext';
import { requireDeviceRunSessionWorkerApi } from './deviceRunSessionWorkerApi';

const SHORT_COMMIT_HASH_LENGTH = 7;
const MAX_APP_SLUG_LENGTH = 80;
const SESSION_LOOKUP_TIMEOUT_MS = 5_000;
// Runs of characters that are not letters, digits, dots, underscores, or hyphens; each run becomes one hyphen.
const FILENAME_UNSAFE_RUN = /[^a-zA-Z0-9._-]+/g;
// Dots and hyphens at either end of the slug, dropped so the name cannot start with a hidden-file dot.
const LEADING_OR_TRAILING_DOTS_AND_HYPHENS = /^[.-]+|[.-]+$/g;
// A full git commit hash: 40 hex characters for SHA-1 or 64 for SHA-256.
const FULL_GIT_COMMIT_HASH = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;

/**
 * Session details used to name screenshots. `app` is always null: the device run session worker
 * API does not return the app slug.
 */
export type ScreenshotSession = {
  platform: 'IOS' | 'ANDROID';
  app: { slug: string } | null;
  build: { id: string; gitCommitHash: string | null; app: { slug: string } | null } | null;
};

export async function loadScreenshotSessionAsync(
  ctx: CustomBuildContext,
  deviceRunSessionId: string,
  logger: bunyan
): Promise<ScreenshotSession | null> {
  try {
    const signal = AbortSignal.timeout(SESSION_LOOKUP_TIMEOUT_MS);
    const application = await requireDeviceRunSessionWorkerApi(ctx).getApplicationAsync({
      signal,
    });
    return {
      // www runs iOS sessions only on macOS workers and Android sessions only on Linux workers,
      // so the worker API does not return the platform.
      platform: ctx.runtimePlatform === BuildRuntimePlatform.DARWIN ? 'IOS' : 'ANDROID',
      app: null,
      build: application.build
        ? {
            id: application.build.id,
            gitCommitHash: application.build.gitCommitHash,
            app: null,
          }
        : null,
    };
  } catch (err) {
    logger.warn(
      { err, deviceRunSessionId },
      'Could not load screenshot session details; using capture timestamps.'
    );
    return null;
  }
}

export function screenshotArtifactDetails(
  timestamp: string,
  session: ScreenshotSession | null
): { name: string; filename: string; metadata: Record<string, string> } {
  const name = screenshotArtifactName(timestamp);
  if (!session) {
    return {
      name,
      filename: `screenshot-${timestamp}.png`,
      metadata: { __eas_type: 'screenshot' },
    };
  }

  const app = session.build?.app ?? session.app;
  const platform = session.platform.toLowerCase();
  const filenameParts = [platform];
  const metadata: Record<string, string> = { __eas_type: 'screenshot' };
  // Without an app slug, the filename starts with the platform.
  if (app) {
    const appSlug =
      app.slug
        .replace(FILENAME_UNSAFE_RUN, '-')
        .replace(LEADING_OR_TRAILING_DOTS_AND_HYPHENS, '')
        .slice(0, MAX_APP_SLUG_LENGTH) || 'app';
    filenameParts.unshift(appSlug);
    metadata.appSlug = app.slug;
  }
  metadata.platform = platform;

  if (session.build) {
    metadata.buildId = session.build.id;
    const commitHash = session.build.gitCommitHash;
    const hasValidCommitHash = commitHash !== null && FULL_GIT_COMMIT_HASH.test(commitHash);
    if (hasValidCommitHash) {
      filenameParts.push(commitHash.slice(0, SHORT_COMMIT_HASH_LENGTH).toLowerCase());
      metadata.gitCommitHash = commitHash;
    }
  }
  filenameParts.push(timestamp);
  return { name, filename: `${filenameParts.join('-')}.png`, metadata };
}

function screenshotArtifactName(timestamp: string): string {
  // The caller already matched the timestamp against the filename pattern, so this split cannot fail.
  const [date, time] = timestamp.split('T');
  const [hours, minutes, seconds] = time.split('-');
  return `Screenshot ${date} ${hours}:${minutes}:${seconds} UTC`;
}
