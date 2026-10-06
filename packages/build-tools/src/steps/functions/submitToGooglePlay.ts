import { UserError } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import {
  BuildFunction,
  BuildStepInput,
  BuildStepInputValueTypeName,
  BuildStepOutput,
} from '@expo/steps';
import path from 'node:path';
import { z } from 'zod';

import { GooglePlayAuthUtils } from '../utils/android/GooglePlayAuthUtils';
import { GooglePlayClient, ReleaseStatus, ReleaseStatusZ } from '../utils/android/GooglePlayClient';
import { GooglePlayUtils } from '../utils/android/GooglePlayUtils';
import { AndroidArtifactType } from '../utils/android/appArtifact';

const InputsZ = z
  .object({
    artifact_path: z.string().min(1),
    artifact_type: z.enum(['apk', 'aab']),
    package_name: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/),
    service_account_key_path: z.string().min(1),
    track: z.string().trim().min(1).default('internal'),
    release_status: ReleaseStatusZ.default('completed'),
    rollout: z.number().finite().gt(0).max(1).optional(),
    changelog: z.string().optional(),
    changes_not_sent_for_review: z.boolean().default(false),
  })
  .superRefine(({ release_status, rollout }, ctx) => {
    if (release_status === 'draft' && rollout !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['rollout'],
        message: 'A draft release cannot have a rollout.',
      });
    }
    if (release_status === 'inProgress' && rollout === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['rollout'],
        message: 'An inProgress release requires a rollout greater than 0 and at most 1.',
      });
    }
    if (release_status === 'halted' && rollout !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['rollout'],
        message: 'A halted release cannot have a rollout. Omit rollout or use inProgress status.',
      });
    }
  });

export function createSubmitToGooglePlayBuildFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'submit_to_google_play',
    name: 'Submit to Google Play',
    __metricsId: 'eas/submit_to_google_play',
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'artifact_path',
        required: true,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'artifact_type',
        required: true,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'package_name',
        required: true,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'service_account_key_path',
        required: true,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
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
    outputProviders: [BuildStepOutput.createProvider({ id: 'version_code', required: true })],
    fn: async (ctx, { inputs, outputs, signal }) => {
      signal?.throwIfAborted();
      const parsed = InputsZ.safeParse(
        Object.fromEntries(Object.entries(inputs).map(([key, input]) => [key, input.value]))
      );
      if (!parsed.success) {
        throw new UserError(
          'EAS_GOOGLE_PLAY_INVALID_INPUT',
          'Invalid Google Play submission inputs:\n' + z.prettifyError(parsed.error)
        );
      }
      const submission = parsed.data;
      const { release_status: requested, rollout } = submission;
      // Match Fastlane: a partial rollout overrides the requested status to inProgress.
      const release: {
        status: ReleaseStatus;
        userFraction?: number;
      } =
        rollout !== undefined && rollout < 1
          ? { status: 'inProgress', userFraction: rollout }
          : { status: requested === 'inProgress' ? 'completed' : requested };
      const credentials = await GooglePlayAuthUtils.loadGoogleServiceAccountAsync({
        keyPath: path.resolve(ctx.workingDirectory, submission.service_account_key_path),
      });
      const artifactPath = path.resolve(ctx.workingDirectory, submission.artifact_path);
      const client = new GooglePlayClient(credentials);
      const versionCode = await submitToGooglePlayAsync({
        artifactType: submission.artifact_type,
        client,
        submission: {
          package_name: submission.package_name,
          track: submission.track,
          release_status: submission.release_status,
          rollout: submission.rollout,
          changelog: submission.changelog,
          changes_not_sent_for_review: submission.changes_not_sent_for_review,
          artifact_path: artifactPath,
        },
        release,
        logger: ctx.logger,
        signal,
      });
      outputs.version_code.set(String(versionCode));
    },
  });
}

async function submitToGooglePlayAsync({
  artifactType,
  client,
  submission,
  release,
  logger,
  signal,
}: {
  artifactType: AndroidArtifactType;
  client: GooglePlayClient;
  submission: {
    package_name: string;
    track: string;
    release_status: ReleaseStatus;
    rollout?: number;
    changelog?: string;
    changes_not_sent_for_review: boolean;
    artifact_path: string;
  };
  release: { status: ReleaseStatus; userFraction?: number };
  logger: bunyan;
  signal?: AbortSignal;
}): Promise<number> {
  let editId: string | undefined;
  let committed = false;
  try {
    const packageName = submission.package_name;
    logger.info(
      `Submitting ${packageName} (${artifactType}) to track ${JSON.stringify(submission.track)}.`
    );
    logger.info(
      `Requested status: ${submission.release_status}; rollout: ${submission.rollout ?? 'none'}. Effective status: ${release.status}; rollout: ${release.userFraction ?? 'none'}. changes_not_sent_for_review: ${submission.changes_not_sent_for_review}.`
    );
    if (submission.changelog) {
      logger.info(`Changelog (en-US): ${JSON.stringify(submission.changelog)}`);
    }
    editId = (await GooglePlayUtils.createEditAsync(client, { packageName, signal })).id;
    let lastPercent: number | undefined;
    const { versionCode } = await GooglePlayUtils.uploadApplicationAsync(client, {
      packageName,
      editId,
      artifactPath: submission.artifact_path,
      artifactType,
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
    await GooglePlayUtils.updateTrackAsync(client, {
      packageName,
      editId,
      track: submission.track,
      release,
      versionCode,
      changelog: submission.changelog ? { locale: 'en-US', text: submission.changelog } : undefined,
      signal,
    });
    logger.info('Updated Google Play track ' + JSON.stringify(submission.track) + ' in the edit.');
    // Commit also validates the edit.
    await GooglePlayUtils.commitEditAsync(client, {
      packageName,
      editId,
      changesNotSentForReview: submission.changes_not_sent_for_review,
      logger,
      signal,
    });
    committed = true;
    logger.info(
      `Submitted ${packageName}, version ${versionCode}, to ${JSON.stringify(submission.track)}.`
    );
    return versionCode;
  } catch (error) {
    throw GooglePlayUtils.mapGooglePlayError(error);
  } finally {
    if (editId && !committed) {
      try {
        await GooglePlayUtils.deleteEditAsync(client, {
          packageName: submission.package_name,
          editId,
          signal: AbortSignal.timeout(30_000),
        });
      } catch {
        logger.warn(
          'Could not delete the Google Play edit after failure. The original submission error is preserved.'
        );
      }
    }
  }
}
