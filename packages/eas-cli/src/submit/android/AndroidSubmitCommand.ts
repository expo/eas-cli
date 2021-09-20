import { Platform } from '@expo/eas-build-job';
import { AndroidReleaseStatus, AndroidReleaseTrack } from '@expo/eas-json';
import { Result, result } from '@expo/results';

import {
  SubmissionAndroidReleaseStatus,
  SubmissionAndroidTrack,
  SubmissionFragment,
} from '../../graphql/generated';
import Log from '../../log';
import { getApplicationIdAsync } from '../../project/android/applicationId';
import * as gradleUtils from '../../project/android/gradleUtils';
import capitalize from '../../utils/expodash/capitalize';
import { ArchiveSource } from '../ArchiveSource';
import { resolveArchiveSource } from '../commons';
import { SubmissionContext } from '../context';
import { AndroidPackageSource, AndroidPackageSourceType } from './AndroidPackageSource';
import AndroidSubmitter, { AndroidSubmissionOptions } from './AndroidSubmitter';
import { ServiceAccountSource, ServiceAccountSourceType } from './ServiceAccountSource';

export default class AndroidSubmitCommand {
  constructor(private ctx: SubmissionContext<Platform.ANDROID>) {}

  async runAsync(): Promise<SubmissionFragment> {
    Log.addNewLineIfNone();
    const submissionOptions = await this.getAndroidSubmissionOptionsAsync();
    const submitter = new AndroidSubmitter(this.ctx, submissionOptions);
    return await submitter.submitAsync();
  }

  private async getAndroidSubmissionOptionsAsync(): Promise<AndroidSubmissionOptions> {
    const androidPackageSource = await this.resolveAndroidPackageSourceAsync();
    const track = this.resolveTrack();
    const releaseStatus = this.resolveReleaseStatus();
    const archiveSource = this.resolveArchiveSource();
    const serviceAccountSource = this.resolveServiceAccountSource();

    const errored = [
      androidPackageSource,
      track,
      releaseStatus,
      archiveSource,
      serviceAccountSource,
    ].filter(r => !r.ok);
    if (errored.length > 0) {
      const message = errored.map(err => err.reason?.message).join('\n');
      Log.error(message);
      throw new Error('Submission failed');
    }

    return {
      projectId: this.ctx.projectId,
      androidPackageSource: androidPackageSource.enforceValue(),
      track: track.enforceValue(),
      releaseStatus: releaseStatus.enforceValue(),
      archiveSource: archiveSource.enforceValue(),
      serviceAccountSource: serviceAccountSource.enforceValue(),
      changesNotSentForReview: this.ctx.profile.changesNotSentForReview,
    };
  }

  private async maybeGetAndroidPackageFromCurrentProjectAsync(): Promise<string | undefined> {
    try {
      return await getApplicationIdAsync(this.ctx.projectDir, this.ctx.exp, {
        moduleName: gradleUtils.DEFAULT_MODULE_NAME,
      });
    } catch {
      return undefined;
    }
  }

  private async resolveAndroidPackageSourceAsync(): Promise<Result<AndroidPackageSource>> {
    const androidPackage = await this.maybeGetAndroidPackageFromCurrentProjectAsync();
    if (androidPackage) {
      return result({
        sourceType: AndroidPackageSourceType.userDefined,
        androidPackage,
      });
    } else if (this.ctx.nonInteractive) {
      return result(new Error("Couldn't resolve the Android package."));
    } else {
      return result({
        sourceType: AndroidPackageSourceType.prompt,
      });
    }
  }

  private resolveTrack(): Result<SubmissionAndroidTrack> {
    const { track } = this.ctx.profile;
    if (!track) {
      return result(SubmissionAndroidTrack.Internal);
    }
    const capitalizedTrack = capitalize(track);
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
    const capitalizedReleaseStatus = capitalize(releaseStatus);
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

  private resolveArchiveSource(): Result<ArchiveSource> {
    try {
      return result(resolveArchiveSource(this.ctx, Platform.ANDROID));
    } catch (err: any) {
      return result(err);
    }
  }

  private resolveServiceAccountSource(): Result<ServiceAccountSource> {
    const { serviceAccountKeyPath } = this.ctx.profile;
    if (serviceAccountKeyPath) {
      return result({
        sourceType: ServiceAccountSourceType.path,
        path: serviceAccountKeyPath,
      });
    } else if (this.ctx.nonInteractive) {
      return result(new Error('Set serviceAccountKeyPath in the submit profile (eas.json).'));
    } else {
      return result({
        sourceType: ServiceAccountSourceType.detect,
      });
    }
  }
}
