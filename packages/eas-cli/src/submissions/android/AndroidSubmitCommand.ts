import { getConfig } from '@expo/config';
import { AndroidSubmitProfile } from '@expo/eas-json';
import { Result, result } from '@expo/results';

import { AppPlatform, SubmissionFragment } from '../../graphql/generated';
import Log from '../../log';
import { getApplicationIdAsync } from '../../project/android/applicationId';
import { ArchiveSource } from '../ArchiveSource';
import { resolveArchiveSource } from '../commons';
import { SubmissionContext, SubmitArchiveFlags } from '../types';
import { AndroidPackageSource, AndroidPackageSourceType } from './AndroidPackageSource';
import { ReleaseStatus, ReleaseTrack } from './AndroidSubmissionConfig';
import AndroidSubmitter, { AndroidSubmissionOptions } from './AndroidSubmitter';
import { ServiceAccountSource, ServiceAccountSourceType } from './ServiceAccountSource';

export default class AndroidSubmitCommand {
  static createContext({
    archiveFlags,
    profile,
    projectDir,
    projectId,
  }: {
    archiveFlags: SubmitArchiveFlags;
    profile: AndroidSubmitProfile;
    projectDir: string;
    projectId: string;
  }): SubmissionContext<AppPlatform.Android> {
    return {
      archiveFlags,
      platform: AppPlatform.Android,
      profile,
      projectDir,
      projectId,
    };
  }

  constructor(private ctx: SubmissionContext<AppPlatform.Android>) {}

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
      throw new Error('Failed to submit the app');
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
    const { exp } = getConfig(this.ctx.projectDir, { skipSDKVersionRequirement: true });
    try {
      return await getApplicationIdAsync(this.ctx.projectDir, exp);
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
    } else {
      return result({
        sourceType: AndroidPackageSourceType.prompt,
      });
    }
  }

  private resolveTrack(): Result<ReleaseTrack> {
    const { track } = this.ctx.profile;
    if (!track) {
      return result(ReleaseTrack.internal);
    }
    if (track in ReleaseTrack) {
      return result(ReleaseTrack[track as keyof typeof ReleaseTrack]);
    } else {
      return result(
        new Error(
          `Unsupported track: ${track} (valid options: ${Object.keys(ReleaseTrack).join(', ')})`
        )
      );
    }
  }

  private resolveReleaseStatus(): Result<ReleaseStatus> {
    const { releaseStatus } = this.ctx.profile;
    if (!releaseStatus) {
      return result(ReleaseStatus.completed);
    }
    if (releaseStatus in ReleaseStatus) {
      return result(ReleaseStatus[releaseStatus as keyof typeof ReleaseStatus]);
    } else {
      return result(
        new Error(
          `Unsupported release status: ${releaseStatus} (valid options: ${Object.keys(
            ReleaseStatus
          ).join(', ')})`
        )
      );
    }
  }

  private resolveArchiveSource(): Result<ArchiveSource> {
    return result(resolveArchiveSource(this.ctx, AppPlatform.Android));
  }

  private resolveServiceAccountSource(): Result<ServiceAccountSource> {
    const { serviceAccountKeyPath } = this.ctx.profile;
    if (serviceAccountKeyPath) {
      return result({
        sourceType: ServiceAccountSourceType.path,
        path: serviceAccountKeyPath,
      });
    } else {
      return result({
        sourceType: ServiceAccountSourceType.detect,
      });
    }
  }
}
