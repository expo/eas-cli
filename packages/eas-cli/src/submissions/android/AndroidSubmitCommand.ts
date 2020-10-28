import { getConfig } from '@expo/config';
import { Result, result } from '@expo/results';
import * as uuid from 'uuid';

import log from '../../log';
import { ensureProjectExistsAsync } from '../../project/ensureProjectExists';
import { getProjectAccountNameAsync } from '../../project/projectUtils';
import {
  ArchiveFileSource,
  ArchiveFileSourceType,
  ArchiveSource,
  ArchiveTypeSource,
  ArchiveTypeSourceType,
} from '../archive-source';
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
    commandFlags: AndroidSubmitCommandFlags
  ): AndroidSubmissionContext {
    return {
      projectDir,
      commandFlags,
    };
  }

  constructor(private ctx: AndroidSubmissionContext) {}

  async runAsync(): Promise<void> {
    const projectId = await this.getProjectIdAsync();
    log.addNewLineIfNone();

    const submissionOptions = this.getAndroidSubmissionOptions(projectId);
    const submitter = new AndroidSubmitter(this.ctx, submissionOptions);
    await submitter.submitAsync();
  }

  private getAndroidSubmissionOptions(projectId: string): AndroidSubmissionOptions {
    const androidPackageSource = this.resolveAndroidPackageSource();
    const track = this.resolveTrack();
    const releaseStatus = this.resolveReleaseStatus();
    const archiveSource = this.resolveArchiveSource(projectId);
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
      projectId,
      androidPackageSource: androidPackageSource.enforceValue(),
      track: track.enforceValue(),
      releaseStatus: releaseStatus.enforceValue(),
      archiveSource: archiveSource.enforceValue(),
      serviceAccountSource: serviceAccountSource.enforceValue(),
    };
  }

  private async getProjectIdAsync(): Promise<string> {
    const { exp } = getConfig(this.ctx.projectDir, { skipSDKVersionRequirement: true });
    return await ensureProjectExistsAsync({
      accountName: await getProjectAccountNameAsync(this.ctx.projectDir),
      projectName: exp.slug,
    });
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
      archiveFile: this.resolveArchiveFileSource(projectId),
      archiveType: this.resolveArchiveTypeSource(),
    });
  }

  private resolveArchiveFileSource(projectId: string): ArchiveFileSource {
    const { url, path, id, latest } = this.ctx.commandFlags;
    const chosenOptions = [url, path, id, latest];
    if (chosenOptions.filter(opt => opt).length > 1) {
      throw new Error(`Pass only one of: --url, --path, --id, --latest`);
    }

    if (url) {
      return {
        sourceType: ArchiveFileSourceType.url,
        url,
        projectId,
        platform: SubmissionPlatform.Android,
        projectDir: this.ctx.projectDir,
      };
    } else if (path) {
      return {
        sourceType: ArchiveFileSourceType.path,
        path,
        projectId,
        platform: SubmissionPlatform.Android,
        projectDir: this.ctx.projectDir,
      };
    } else if (id) {
      if (!uuid.validate(id)) {
        throw new Error(`${id} is not an ID`);
      }
      return {
        sourceType: ArchiveFileSourceType.buildId,
        id,
        projectId,
        platform: SubmissionPlatform.Android,
        projectDir: this.ctx.projectDir,
      };
    } else if (latest) {
      return {
        sourceType: ArchiveFileSourceType.latest,
        platform: SubmissionPlatform.Android,
        projectDir: this.ctx.projectDir,
        projectId,
      };
    } else {
      return {
        sourceType: ArchiveFileSourceType.prompt,
        platform: SubmissionPlatform.Android,
        projectDir: this.ctx.projectDir,
        projectId,
      };
    }
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
