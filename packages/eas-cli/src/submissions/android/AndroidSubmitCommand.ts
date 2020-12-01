import { getConfig } from '@expo/config';
import { Result, result } from '@expo/results';

import log from '../../log';
import { ArchiveSource, ArchiveTypeSource, ArchiveTypeSourceType } from '../archiveSource';
import { resolveArchiveFileSource } from '../commons';
import {
  AndroidArchiveType,
  AndroidSubmissionContext,
  AndroidSubmitCommandFlags,
  SubmissionPlatform,
} from '../types';
import { AndroidPackageSource, AndroidPackageSourceType } from './AndroidPackageSource';
import { ReleaseStatus, ReleaseTrack } from './AndroidSubmissionConfig';
import AndroidSubmitter, { AndroidSubmissionOptions } from './AndroidSubmitter';
import { ServiceAccountSource, ServiceAccountSourceType } from './ServiceAccountSource';

class AndroidSubmitCommand {
  static createContext(
    projectDir: string,
    projectId: string,
    commandFlags: AndroidSubmitCommandFlags
  ): AndroidSubmissionContext {
    return {
      projectDir,
      projectId,
      commandFlags,
    };
  }

  constructor(private ctx: AndroidSubmissionContext) {}

  async runAsync(): Promise<void> {
    log.addNewLineIfNone();
    const submissionOptions = this.getAndroidSubmissionOptions();
    const submitter = new AndroidSubmitter(this.ctx, submissionOptions);
    await submitter.submitAsync();
  }

  private getAndroidSubmissionOptions(): AndroidSubmissionOptions {
    const androidPackageSource = this.resolveAndroidPackageSource();
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
      log.error(message);
      throw new Error('Failed to submit the app');
    }

    return {
      projectId: this.ctx.projectId,
      androidPackageSource: androidPackageSource.enforceValue(),
      track: track.enforceValue(),
      releaseStatus: releaseStatus.enforceValue(),
      archiveSource: archiveSource.enforceValue(),
      serviceAccountSource: serviceAccountSource.enforceValue(),
    };
  }

  private resolveAndroidPackageSource(): Result<AndroidPackageSource> {
    let androidPackage: string | undefined;
    if (this.ctx.commandFlags.androidPackage) {
      androidPackage = this.ctx.commandFlags.androidPackage;
    }
    const { exp } = getConfig(this.ctx.projectDir, { skipSDKVersionRequirement: true });
    if (exp.android?.package) {
      androidPackage = exp.android.package;
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
      archiveFile: resolveArchiveFileSource(SubmissionPlatform.Android, this.ctx, projectId),
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
    const { key } = this.ctx.commandFlags;
    if (key) {
      return result({
        sourceType: ServiceAccountSourceType.path,
        path: key,
      });
    } else {
      return result({
        sourceType: ServiceAccountSourceType.prompt,
      });
    }
  }
}

export default AndroidSubmitCommand;
