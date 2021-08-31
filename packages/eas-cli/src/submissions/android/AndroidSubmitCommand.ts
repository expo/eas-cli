import { getConfig } from '@expo/config';
import { Result, result } from '@expo/results';

import { AppPlatform, SubmissionFragment } from '../../graphql/generated';
import Log from '../../log';
import { getApplicationIdAsync } from '../../project/android/applicationId';
import { ArchiveSource, ArchiveTypeSource, ArchiveTypeSourceType } from '../archiveSource';
import { resolveArchiveFileSource } from '../commons';
import { AndroidArchiveType, AndroidSubmissionContext, AndroidSubmitCommandFlags } from '../types';
import { AndroidPackageSource, AndroidPackageSourceType } from './AndroidPackageSource';
import { ReleaseStatus, ReleaseTrack } from './AndroidSubmissionConfig';
import AndroidSubmitter, { AndroidSubmissionOptions } from './AndroidSubmitter';
import { ServiceAccountSource, ServiceAccountSourceType } from './ServiceAccountSource';

class AndroidSubmitCommand {
  static createContext({
    projectDir,
    projectId,
    commandFlags,
  }: {
    projectDir: string;
    projectId: string;
    commandFlags: AndroidSubmitCommandFlags;
  }): AndroidSubmissionContext {
    return {
      projectDir,
      projectId,
      commandFlags,
    };
  }

  constructor(private ctx: AndroidSubmissionContext) {}

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
    const archiveSource = this.resolveArchiveSource(this.ctx.projectId);
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
      changesNotSentForReview: this.ctx.commandFlags.changesNotSentForReview,
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
    let androidPackage: string | undefined;
    if (this.ctx.commandFlags.androidPackage) {
      androidPackage = this.ctx.commandFlags.androidPackage;
    } else {
      androidPackage = await this.maybeGetAndroidPackageFromCurrentProjectAsync();
    }
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
    const { track } = this.ctx.commandFlags;
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
    const { releaseStatus } = this.ctx.commandFlags;
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

  private resolveArchiveSource(projectId: string): Result<ArchiveSource> {
    return result({
      archiveFile: resolveArchiveFileSource(AppPlatform.Android, this.ctx, projectId),
      archiveType: this.resolveArchiveTypeSource(),
    });
  }

  private resolveArchiveTypeSource(): ArchiveTypeSource {
    const { type: rawArchiveType } = this.ctx.commandFlags;
    if (rawArchiveType) {
      if (!(rawArchiveType in AndroidArchiveType)) {
        throw new Error(
          `Unsupported archive type: ${rawArchiveType} (valid options: ${Object.keys(
            AndroidArchiveType
          ).join(', ')})`
        );
      }
      const archiveType = rawArchiveType as AndroidArchiveType;
      return {
        sourceType: ArchiveTypeSourceType.parameter,
        archiveType,
      };
    } else {
      return {
        sourceType: ArchiveTypeSourceType.infer,
      };
    }
  }

  private resolveServiceAccountSource(): Result<ServiceAccountSource> {
    const { serviceAccountKeyPath } = this.ctx.commandFlags;
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

export default AndroidSubmitCommand;
