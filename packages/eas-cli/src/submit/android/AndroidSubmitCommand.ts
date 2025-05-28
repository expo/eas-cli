import { Platform } from '@expo/eas-build-job';
import { AndroidReleaseStatus, AndroidReleaseTrack } from '@expo/eas-json';
import { Result, result } from '@expo/results';

import AndroidSubmitter, { AndroidSubmissionOptions } from './AndroidSubmitter';
import { ServiceAccountSource, ServiceAccountSourceType } from './ServiceAccountSource';
import { SubmissionAndroidReleaseStatus, SubmissionAndroidTrack } from '../../graphql/generated';
import Log from '../../log';
import {
  AmbiguousApplicationIdError,
  getApplicationIdAsync,
} from '../../project/android/applicationId';
import capitalizeFirstLetter from '../../utils/expodash/capitalize';
import { ArchiveSource, ArchiveSourceType, getArchiveAsync } from '../ArchiveSource';
import { refreshContextSubmitProfileAsync, resolveArchiveSource } from '../commons';
import { SubmissionContext } from '../context';

export default class AndroidSubmitCommand {
  constructor(private ctx: SubmissionContext<Platform.ANDROID>) {}

  async runAsync(): Promise<AndroidSubmitter> {
    Log.addNewLineIfNone();
    const archiveSource = this.resolveArchiveSource();
    if (!archiveSource.ok) {
      Log.error(archiveSource.reason?.message);
      throw new Error('Submission failed');
    }

    const archiveSourceValue = archiveSource.enforceValue();
    const archive = await getArchiveAsync(
      {
        graphqlClient: this.ctx.graphqlClient,
        platform: Platform.ANDROID,
        projectId: this.ctx.projectId,
        nonInteractive: this.ctx.nonInteractive,
      },
      archiveSourceValue
    );
    const archiveProfile =
      archive.sourceType === ArchiveSourceType.build ? archive.build.buildProfile : undefined;

    if (archiveProfile && !this.ctx.specifiedProfile) {
      this.ctx = await refreshContextSubmitProfileAsync(this.ctx, archiveProfile);
    }
    const submissionOptions = await this.getAndroidSubmissionOptionsAsync(archiveSourceValue);
    const submitter = new AndroidSubmitter(this.ctx, submissionOptions, archive);
    return submitter;
  }

  private async getAndroidSubmissionOptionsAsync(
    archiveSource: ArchiveSource
  ): Promise<AndroidSubmissionOptions> {
    const track = this.resolveTrack();
    const releaseStatus = this.resolveReleaseStatus();
    const rollout = this.resolveRollout();
    const serviceAccountSource = await this.resolveServiceAccountSourceAsync();

    const errored = [track, releaseStatus, serviceAccountSource, rollout].filter(r => !r.ok);
    if (errored.length > 0) {
      const message = errored.map(err => err.reason?.message).join('\n');
      Log.error(message);
      throw new Error('Submission failed');
    }

    return {
      projectId: this.ctx.projectId,
      track: track.enforceValue(),
      releaseStatus: releaseStatus.enforceValue(),
      rollout: rollout.enforceValue(),
      archiveSource,
      serviceAccountSource: serviceAccountSource.enforceValue(),
      changesNotSentForReview: this.ctx.profile.changesNotSentForReview,
    };
  }

  private async maybeGetAndroidPackageFromCurrentProjectAsync(): Promise<Result<string | null>> {
    try {
      return result(
        await getApplicationIdAsync(this.ctx.projectDir, this.ctx.exp, this.ctx.vcsClient)
      );
    } catch (error: any) {
      if (error instanceof AmbiguousApplicationIdError) {
        Log.warn(
          '"applicationId" is ambiguous, specify it via "applicationId" field in the submit profile in the eas.json.'
        );
        return result(null);
      }
      return result(
        new Error(`Failed to resolve applicationId in Android project: ${error.message}.`)
      );
    }
  }

  private resolveTrack(): Result<SubmissionAndroidTrack> {
    const { track } = this.ctx.profile;
    if (!track) {
      return result(SubmissionAndroidTrack.Internal);
    }
    const capitalizedTrack = capitalizeFirstLetter(track);
    if (capitalizedTrack in SubmissionAndroidTrack) {
      return result(
        SubmissionAndroidTrack[capitalizedTrack as keyof typeof SubmissionAndroidTrack]
      );
    } else {
      return result(
        new Error(
          `Unsupported track: ${track} (valid options: ${Object.keys(AndroidReleaseTrack).join(
            ', '
          )})`
        )
      );
    }
  }

  private resolveReleaseStatus(): Result<SubmissionAndroidReleaseStatus> {
    const { releaseStatus } = this.ctx.profile;
    if (!releaseStatus) {
      return result(SubmissionAndroidReleaseStatus.Completed);
    }
    const capitalizedReleaseStatus = capitalizeFirstLetter(releaseStatus);
    if (capitalizedReleaseStatus in SubmissionAndroidReleaseStatus) {
      return result(
        SubmissionAndroidReleaseStatus[
          capitalizedReleaseStatus as keyof typeof SubmissionAndroidReleaseStatus
        ]
      );
    } else {
      return result(
        new Error(
          `Unsupported release status: ${releaseStatus} (valid options: ${Object.keys(
            AndroidReleaseStatus
          ).join(', ')})`
        )
      );
    }
  }

  private resolveRollout(): Result<number | undefined> {
    const { rollout } = this.ctx.profile;

    return result(rollout);
  }

  private resolveArchiveSource(): Result<ArchiveSource> {
    try {
      return result(resolveArchiveSource(this.ctx));
    } catch (err: any) {
      return result(err);
    }
  }

  private async resolveServiceAccountSourceAsync(): Promise<Result<ServiceAccountSource>> {
    const { serviceAccountKeyPath } = this.ctx.profile;
    if (serviceAccountKeyPath) {
      return result({
        sourceType: ServiceAccountSourceType.path,
        path: serviceAccountKeyPath,
      });
    }
    let androidApplicationIdentifier: string | undefined =
      this.ctx.applicationIdentifierOverride ?? this.ctx.profile.applicationId;
    if (!androidApplicationIdentifier) {
      const androidApplicationIdentifierResult =
        await this.maybeGetAndroidPackageFromCurrentProjectAsync();
      if (!androidApplicationIdentifierResult.ok) {
        return result(androidApplicationIdentifierResult.reason);
      }
      const androidApplicationIdentifierValue = androidApplicationIdentifierResult.enforceValue();
      if (androidApplicationIdentifierValue) {
        androidApplicationIdentifier = androidApplicationIdentifierValue;
      }
    }
    return result({
      sourceType: ServiceAccountSourceType.credentialsService,
      androidApplicationIdentifier,
    });
  }
}
