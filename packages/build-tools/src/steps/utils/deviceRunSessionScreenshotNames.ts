import type { bunyan } from '@expo/logger';
import { graphql } from 'gql.tada';
import { z } from 'zod';

import type { CustomBuildContext } from '../../customBuildContext';
import { graphqlAbortContext } from '../../utils/graphqlAbort';

const SHORT_COMMIT_HASH_LENGTH = 7;
const MAX_APP_SLUG_LENGTH = 80;
const SESSION_LOOKUP_TIMEOUT_MS = 5_000;
// Runs of characters that are not letters, digits, dots, underscores, or hyphens; each run becomes one hyphen.
const FILENAME_UNSAFE_RUN = /[^a-zA-Z0-9._-]+/g;
// Dots and hyphens at either end of the slug, dropped so the name cannot start with a hidden-file dot.
const LEADING_OR_TRAILING_DOTS_AND_HYPHENS = /^[.-]+|[.-]+$/g;
// A full git commit hash: 40 hex characters for SHA-1 or 64 for SHA-256.
const FULL_GIT_COMMIT_HASH = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;

const SCREENSHOT_SESSION_QUERY = graphql(`
  query ScreenshotSession($deviceRunSessionId: ID!) {
    deviceRunSessions {
      byId(deviceRunSessionId: $deviceRunSessionId) {
        platform
        app { slug }
        build {
          id
          gitCommitHash
          app { slug }
        }
      }
    }
  }
`);

const AppSchema = z.object({ slug: z.string() });
const ScreenshotSessionSchema = z.object({
  platform: z.enum(['IOS', 'ANDROID']),
  app: AppSchema,
  build: z
    .object({
      id: z.string(),
      gitCommitHash: z.string().nullable(),
      app: AppSchema,
    })
    .nullable(),
});

export type ScreenshotSession = z.infer<typeof ScreenshotSessionSchema>;

export async function loadScreenshotSessionAsync(
  ctx: CustomBuildContext,
  deviceRunSessionId: string,
  logger: bunyan
): Promise<ScreenshotSession | null> {
  try {
    const result = await ctx.graphqlClient
      .query(
        SCREENSHOT_SESSION_QUERY,
        { deviceRunSessionId },
        graphqlAbortContext(AbortSignal.timeout(SESSION_LOOKUP_TIMEOUT_MS))
      )
      .toPromise();
    if (result.error) {
      throw result.error;
    }
    return ScreenshotSessionSchema.parse(result.data?.deviceRunSessions.byId);
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
): { name: string; filename: string; metadata: Record<string, unknown> } {
  const name = screenshotArtifactName(timestamp);
  if (!session) {
    return { name, filename: `screenshot-${timestamp}.png`, metadata: {} };
  }

  const app = session.build?.app ?? session.app;
  const appSlug =
    app.slug
      .replace(FILENAME_UNSAFE_RUN, '-')
      .replace(LEADING_OR_TRAILING_DOTS_AND_HYPHENS, '')
      .slice(0, MAX_APP_SLUG_LENGTH) || 'app';
  const platform = session.platform.toLowerCase();
  const filenameParts = [appSlug, platform];
  const metadata: Record<string, unknown> = { appSlug: app.slug, platform };

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
