import { SystemError, UserError } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import fs from 'node:fs/promises';
import promiseRetry from 'promise-retry';

import { GooglePlayAuthRequestError } from './GooglePlayAuthClient';
import { GooglePlayApiError, GooglePlayClient, ReleaseStatus } from './GooglePlayClient';
import { GooglePlayResumableUpload } from './GooglePlayResumableUpload';
import { AndroidArtifactType } from './appArtifact';

export namespace GooglePlayUtils {
  export async function uploadApplicationAsync(
    client: GooglePlayClient,
    options: {
      packageName: string;
      editId: string;
      artifactPath: string;
      artifactType: AndroidArtifactType;
      signal?: AbortSignal;
      onProgress?: (uploadedBytes: number, totalBytes: number) => void;
    }
  ): Promise<{ versionCode: number }> {
    options.signal?.throwIfAborted();
    const file = await fs.open(options.artifactPath, 'r');
    try {
      const { size } = await file.stat();
      if (!Number.isSafeInteger(size) || size <= 0) {
        throw new UserError(
          'EAS_GOOGLE_PLAY_INVALID_BINARY',
          'Cannot upload an empty or invalid Android binary.'
        );
      }
      return await promiseRetry(
        async retry => {
          const session = await GooglePlayResumableUpload.createUploadSessionAsync({
            ...options,
            client,
            size,
          });
          try {
            return await GooglePlayResumableUpload.uploadSessionAsync({
              ...options,
              file,
              size,
              session,
            });
          } catch (error) {
            options.signal?.throwIfAborted();
            // 404/410 from an existing session mean it is gone; other failures
            // must not restart the whole file upload.
            if (error instanceof GooglePlayApiError && [404, 410].includes(error.status)) {
              retry(error);
            }
            throw error;
          }
        },
        { retries: 2, factor: 2, minTimeout: 1000, maxTimeout: 32_000, randomize: true }
      );
    } finally {
      await file.close();
    }
  }

  export async function createEditAsync(
    client: GooglePlayClient,
    { packageName, signal }: { packageName: string; signal?: AbortSignal }
  ): Promise<{ id: string }> {
    return await client.postAsync(
      '/androidpublisher/v3/applications/:packageName/edits',
      {},
      { packageName },
      { signal }
    );
  }

  export async function updateTrackAsync(
    client: GooglePlayClient,
    {
      packageName,
      editId,
      track,
      release,
      versionCode,
      changelog,
      signal,
    }: {
      packageName: string;
      editId: string;
      track: string;
      release: { status: ReleaseStatus; userFraction?: number };
      versionCode: number;
      changelog?: { locale: string; text: string };
      signal?: AbortSignal;
    }
  ): Promise<void> {
    await client.putAsync(
      '/androidpublisher/v3/applications/:packageName/edits/:editId/tracks/:track',
      {
        track,
        releases: [
          {
            ...release,
            versionCodes: [String(versionCode)],
            ...(changelog
              ? { releaseNotes: [{ language: changelog.locale, text: changelog.text }] }
              : {}),
          },
        ],
      },
      { packageName, editId, track },
      signal
    );
  }

  export async function deleteEditAsync(
    client: GooglePlayClient,
    { packageName, editId, signal }: { packageName: string; editId: string; signal?: AbortSignal }
  ): Promise<void> {
    await client.deleteAsync(
      '/androidpublisher/v3/applications/:packageName/edits/:editId',
      { packageName, editId },
      signal
    );
  }

  export async function commitEditAsync(
    client: GooglePlayClient,
    {
      packageName,
      editId,
      changesNotSentForReview,
      logger,
      signal,
    }: {
      packageName: string;
      editId: string;
      changesNotSentForReview: boolean;
      logger: bunyan;
      signal?: AbortSignal;
    }
  ): Promise<void> {
    const commitOnceAsync = async ({
      changesNotSentForReview,
    }: {
      changesNotSentForReview?: boolean;
    }): Promise<void> => {
      signal?.throwIfAborted();
      try {
        const committed = await client.postAsync(
          '/androidpublisher/v3/applications/:packageName/edits/:editId:commit',
          {},
          { packageName, editId },
          { query: { changesNotSentForReview }, signal }
        );
        if (committed?.id !== editId) {
          throw new SystemError('Google did not confirm the committed edit.');
        }
      } catch (error) {
        if (error instanceof GooglePlayAuthRequestError) {
          throw error;
        }
        if (
          !(error instanceof GooglePlayApiError) ||
          error.status >= 500 ||
          error.status === 408 ||
          error.status === 429
        ) {
          throw new SystemError(
            'Google Play commit outcome is unknown. Check the release in Play Console before you submit again. The commit was not retried.',
            { cause: error }
          );
        }
        throw error;
      }
    };
    try {
      await commitOnceAsync({ changesNotSentForReview });
    } catch (error) {
      if (!(error instanceof GooglePlayApiError) || error.status !== 400) {
        throw error;
      }
      // Match Fastlane: Google can reject the review parameter even when it is false.
      // This explicit rejection permits one retry with the parameter omitted.
      if (
        error.apiMessage.includes('The query parameter changesNotSentForReview must not be set')
      ) {
        logger.warn(
          'Google requires changesNotSentForReview to be omitted. Retrying commit once with that setting.'
        );
        await commitOnceAsync({});
      } else if (
        !changesNotSentForReview &&
        error.apiMessage.includes('Please set the query parameter changesNotSentForReview to true')
      ) {
        logger.warn(
          'Google requires changesNotSentForReview=true. Retrying commit once with that setting.'
        );
        await commitOnceAsync({ changesNotSentForReview: true });
      } else {
        throw error;
      }
    }
  }

  export function mapGooglePlayError(error: unknown): unknown {
    if (
      error instanceof GooglePlayAuthRequestError &&
      error.status >= 400 &&
      error.status < 500 &&
      error.status !== 408 &&
      error.status !== 429
    ) {
      return new UserError(
        'EAS_GOOGLE_PLAY_INVALID_CREDENTIALS',
        `Google rejected the service-account key (${error.errorCode ?? `HTTP ${error.status}`}). Check that the key is valid and the service account is enabled.`,
        { cause: error }
      );
    }
    if (!(error instanceof GooglePlayApiError)) {
      return error;
    }
    const message = error.apiMessage;
    const reasons = new Set(error.reasons);
    let code = 'EAS_GOOGLE_PLAY_REQUEST_FAILED';
    let detail = `Google Play rejected the request (HTTP ${error.status}; reasons: ${error.reasons.join(', ') || 'unspecified'}). Check the app and release settings in Play Console. Concurrent edits or Console changes can invalidate an edit.`;
    if (message.includes('Package not found')) {
      code = 'EAS_GOOGLE_PLAY_FIRST_UPLOAD';
      detail =
        'Google Play cannot find the app. Check the package name and upload the first version manually in Play Console.';
    } else if (
      /version code.*already (?:been )?used/i.test(message) ||
      reasons.has('apkNotificationMessageKeyUpgradeVersionConflict') ||
      message.includes('apkNotificationMessageKeyUpgradeVersionConflict')
    ) {
      code = 'EAS_GOOGLE_PLAY_VERSION_CODE_USED';
      detail =
        'This version code was already uploaded. Increase the Android version code and build a new binary.';
    } else if (
      error.status === 401 ||
      error.status === 403 ||
      message.includes('The caller does not have permission')
    ) {
      code = 'EAS_GOOGLE_PLAY_PERMISSION_DENIED';
      detail =
        'The Google service account cannot submit this app. Check its key and app permissions in Play Console.';
    } else if (
      /privacy policy/i.test(message) ||
      reasons.has('apkNotificationMessageKeyPermissionsRequirePrivacyPolicy') ||
      message.includes('apkNotificationMessageKeyPermissionsRequirePrivacyPolicy')
    ) {
      code = 'EAS_GOOGLE_PLAY_PRIVACY_POLICY_REQUIRED';
      detail = 'This app requires a privacy policy. Add it in Play Console before you submit.';
    } else if (message.includes('Only releases with status draft may be created on draft app')) {
      code = 'EAS_GOOGLE_PLAY_DRAFT_APP';
      detail =
        'This app is a draft in Play Console. Complete its required metadata or submit with release_status: draft.';
    } else if (error.status === 409 || /edit.*(?:expired|invalid|not found)/i.test(message)) {
      code = 'EAS_GOOGLE_PLAY_EDIT_INVALID';
      detail =
        'The Google Play edit is no longer valid. A concurrent edit or Play Console change can invalidate it. Check the app in Play Console before you submit again.';
    } else if (error.status === 400) {
      code = 'EAS_GOOGLE_PLAY_INVALID_RELEASE';
      detail =
        'Google Play rejected the release or review settings. Check the track, release status, rollout, and review settings in Play Console.';
    }
    return new UserError(code, detail, { cause: error });
  }
}
