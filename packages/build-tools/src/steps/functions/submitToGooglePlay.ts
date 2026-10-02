import { UserError } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import {
  BuildFunction,
  BuildStepInput,
  BuildStepInputValueTypeName,
  BuildStepOutput,
} from '@expo/steps';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

import {
  GooglePlayApiError,
  GooglePlayClient,
  GoogleServiceAccount,
} from '../utils/android/GooglePlayClient';
import { GooglePlayUtils } from '../utils/android/GooglePlayUtils';
import { readAndroidArtifactInfoAsync } from '../utils/android/appArtifact';

const submissionSchema = z.object({
  artifact_path: z.string().min(1),
  package_name: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/),
  service_account_key_path: z.string().min(1),
  track: z.string().trim().min(1).default('internal'),
  release_status: z.enum(['completed', 'draft', 'halted', 'inProgress']).default('completed'),
  rollout: z.number().finite().gt(0).max(1).optional(),
  changelog: z.string().optional(),
  changes_not_sent_for_review: z.boolean().default(false),
});

type Submission = z.infer<typeof submissionSchema>;
type Release = {
  status: Submission['release_status'];
  userFraction?: number;
};

export function createSubmitToGooglePlayBuildFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'submit_to_google_play',
    name: 'Submit to Google Play',
    __metricsId: 'eas/submit_to_google_play',
    inputProviders: [
      ...['artifact_path', 'package_name', 'service_account_key_path'].map(id =>
        BuildStepInput.createProvider({
          id,
          required: true,
          allowedValueTypeName: BuildStepInputValueTypeName.STRING,
        })
      ),
      BuildStepInput.createProvider({
        id: 'track',
        required: false,
        defaultValue: 'internal',
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'release_status',
        required: false,
        defaultValue: 'completed',
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'rollout',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.NUMBER,
      }),
      BuildStepInput.createProvider({
        id: 'changelog',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'changes_not_sent_for_review',
        required: false,
        defaultValue: false,
        allowedValueTypeName: BuildStepInputValueTypeName.BOOLEAN,
      }),
    ],
    outputProviders: ['package_name', 'version_code', 'track'].map(id =>
      BuildStepOutput.createProvider({ id, required: true })
    ),
    fn: async (ctx, { inputs, outputs, signal }) => {
      signal?.throwIfAborted();
      const parsed = submissionSchema.safeParse(
        Object.fromEntries(Object.entries(inputs).map(([key, input]) => [key, input.value]))
      );
      if (!parsed.success) {
        throw new UserError(
          'EAS_GOOGLE_PLAY_INVALID_INPUT',
          'Invalid Google Play submission inputs. Check paths, package name, track, release status, and rollout (greater than 0 and at most 1).'
        );
      }
      const submission = parsed.data;
      const release = resolveRelease(submission);
      const credentials = await readCredentialsAsync(
        path.resolve(ctx.workingDirectory, submission.service_account_key_path)
      );
      const result = await submitToGooglePlayAsync({
        client: new GooglePlayClient(credentials),
        submission: {
          ...submission,
          artifact_path: path.resolve(ctx.workingDirectory, submission.artifact_path),
        },
        release,
        logger: ctx.logger,
        signal,
      });
      outputs.package_name.set(result.packageName);
      outputs.version_code.set(String(result.versionCode));
      outputs.track.set(result.track);
    },
  });
}

async function readCredentialsAsync(keyPath: string): Promise<GoogleServiceAccount> {
  try {
    return z
      .object({
        type: z.literal('service_account'),
        client_email: z.email(),
        private_key: z.string().min(1),
        private_key_id: z.string().optional(),
      })
      .parse(JSON.parse(await fs.readFile(keyPath, 'utf8')));
  } catch {
    // Neither JSON parse errors nor validation errors may include credential content.
    throw new UserError(
      'EAS_GOOGLE_PLAY_INVALID_CREDENTIALS',
      'Cannot read the Google service-account key. Provide a valid service-account JSON file.'
    );
  }
}

function resolveRelease(submission: Submission): Release {
  const { release_status: requested, rollout } = submission;
  if (requested === 'draft' && rollout !== undefined) {
    throw new UserError(
      'EAS_GOOGLE_PLAY_INVALID_RELEASE',
      'A draft release cannot have a rollout.'
    );
  }
  if (requested === 'inProgress' && rollout === undefined) {
    throw new UserError(
      'EAS_GOOGLE_PLAY_INVALID_RELEASE',
      'An inProgress release requires a rollout greater than 0 and at most 1.'
    );
  }
  if (requested === 'halted' && rollout === 1) {
    throw new UserError(
      'EAS_GOOGLE_PLAY_INVALID_RELEASE',
      'A halted release cannot have rollout 1. Omit rollout for a halted release, or use completed status.'
    );
  }
  if (rollout !== undefined && rollout < 1) {
    // Match Fastlane: a partial rollout overrides the requested status to inProgress.
    return { status: 'inProgress', userFraction: rollout };
  }
  return { status: requested === 'inProgress' ? 'completed' : requested };
}

async function submitToGooglePlayAsync({
  client,
  submission,
  release,
  logger,
  signal,
}: {
  client: GooglePlayClient;
  submission: Submission;
  release: Release;
  logger: bunyan;
  signal?: AbortSignal;
}): Promise<{ packageName: string; versionCode: number; track: string }> {
  const artifact = await readAndroidArtifactInfoAsync(submission.artifact_path, signal);
  let editId: string | undefined;
  let committed = false;
  try {
    const { packageName } = artifact;
    if (packageName !== submission.package_name) {
      throw new UserError(
        'EAS_GOOGLE_PLAY_PACKAGE_MISMATCH',
        `The binary package (${packageName}) does not match package_name (${submission.package_name}).`
      );
    }
    logger.info(
      `Submitting ${packageName} (${artifact.artifactType}) to track ${JSON.stringify(submission.track)}.`
    );
    logger.info(
      `Requested status: ${submission.release_status}; rollout: ${submission.rollout ?? 'none'}. Effective status: ${release.status}; rollout: ${release.userFraction ?? 'none'}. changes_not_sent_for_review: ${submission.changes_not_sent_for_review}.`
    );
    if (submission.changelog) {
      logger.info(`Changelog (en-US): ${JSON.stringify(submission.changelog)}`);
    }
    const edit = await client.requestAsync<{ id: string }>(
      'POST',
      GooglePlayUtils.editPath(packageName),
      {},
      signal
    );
    if (!edit.id || typeof edit.id !== 'string') {
      throw new Error('Google did not return an edit ID.');
    }
    editId = edit.id;
    let lastPercent = -1;
    const versionCode = await GooglePlayUtils.uploadAsync({
      client,
      packageName,
      editId,
      artifactPath: submission.artifact_path,
      artifactType: artifact.artifactType,
      signal,
      onProgress: (uploaded, total) => {
        const percent = Math.floor((uploaded / total) * 100);
        if (percent !== lastPercent) {
          logger.info(`Upload: ${percent}% (${uploaded}/${total} bytes).`);
          lastPercent = percent;
        }
      },
    });
    logger.info(`Uploaded version code: ${versionCode}.`);
    await client.requestAsync(
      'PUT',
      `${GooglePlayUtils.editPath(packageName, editId)}/tracks/${encodeURIComponent(submission.track)}`,
      {
        track: submission.track,
        releases: [
          {
            ...release,
            versionCodes: [String(versionCode)],
            ...(submission.changelog
              ? { releaseNotes: [{ language: 'en-US', text: submission.changelog }] }
              : {}),
          },
        ],
      },
      signal
    );
    // Commit also validates the edit.
    await commitAsync(
      client,
      packageName,
      editId,
      submission.changes_not_sent_for_review,
      logger,
      signal
    );
    committed = true;
    logger.info(
      `Submitted ${packageName}, version ${versionCode}, to ${JSON.stringify(submission.track)}.`
    );
    return { packageName, versionCode, track: submission.track };
  } catch (error) {
    throw mapGooglePlayError(error);
  } finally {
    if (editId && !committed) {
      try {
        await client.requestAsync(
          'DELETE',
          GooglePlayUtils.editPath(submission.package_name, editId),
          undefined,
          signal
        );
      } catch {
        logger.warn(
          'Could not delete the Google Play edit after failure. The original submission error is preserved.'
        );
      }
    }
  }
}

async function commitAsync(
  client: GooglePlayClient,
  packageName: string,
  editId: string,
  review: boolean,
  logger: bunyan,
  signal?: AbortSignal
): Promise<void> {
  const commit = async (flag?: boolean): Promise<void> => {
    try {
      const committed = await client.requestAsync<{ id?: string }>(
        'POST',
        `${GooglePlayUtils.editPath(packageName, editId)}:commit${flag === undefined ? '' : `?changesNotSentForReview=${flag}`}`,
        {},
        signal
      );
      if (committed?.id !== editId) {
        throw new Error('Google did not confirm the committed edit.');
      }
    } catch (error) {
      if (
        !(error instanceof GooglePlayApiError) ||
        error.status >= 500 ||
        error.status === 408 ||
        error.status === 429
      ) {
        throw new Error(
          'Google Play commit outcome is unknown. Check the release in Play Console before you submit again. The commit was not retried.'
        );
      }
      throw error;
    }
  };
  try {
    await commit(review);
  } catch (error) {
    if (!(error instanceof GooglePlayApiError) || error.status !== 400) {
      throw error;
    }
    if (error.apiMessage.includes('The query parameter changesNotSentForReview must not be set')) {
      logger.warn(
        'Google requires changesNotSentForReview to be omitted. Retrying commit once with that setting.'
      );
      await commit();
    } else if (
      !review &&
      error.apiMessage.includes('Please set the query parameter changesNotSentForReview to true')
    ) {
      logger.warn(
        'Google requires changesNotSentForReview=true. Retrying commit once with that setting.'
      );
      await commit(true);
    } else {
      throw error;
    }
  }
}

function mapGooglePlayError(error: unknown): unknown {
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
  return new UserError(code, detail);
}
