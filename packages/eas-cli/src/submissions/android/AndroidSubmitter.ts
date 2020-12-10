import fs from 'fs-extra';

import BaseSubmitter from '../BaseSubmitter';
import { Archive, ArchiveSource, getArchiveAsync } from '../archiveSource';
import {
  AndroidArchiveType,
  AndroidSubmissionContext,
  ArchiveType,
  SubmissionPlatform,
} from '../types';
import {
  ArchiveSourceSummaryFields,
  breakWord,
  formatArchiveSourceSummary,
  printSummary,
} from '../utils/summary';
import { AndroidPackageSource, getAndroidPackageAsync } from './AndroidPackageSource';
import { AndroidSubmissionConfig, ReleaseStatus, ReleaseTrack } from './AndroidSubmissionConfig';
import { ServiceAccountSource, getServiceAccountAsync } from './ServiceAccountSource';

export interface AndroidSubmissionOptions
  extends Pick<AndroidSubmissionConfig, 'track' | 'releaseStatus' | 'projectId'> {
  androidPackageSource: AndroidPackageSource;
  archiveSource: ArchiveSource;
  serviceAccountSource: ServiceAccountSource;
}

interface ResolvedSourceOptions {
  androidPackage: string;
  archive: Archive;
  serviceAccountPath: string;
}

class AndroidSubmitter extends BaseSubmitter<AndroidSubmissionContext, AndroidSubmissionOptions> {
  protected readonly appStoreName = 'Google Play Store';

  constructor(ctx: AndroidSubmissionContext, options: AndroidSubmissionOptions) {
    super(SubmissionPlatform.Android, ctx, options);
  }

  async submitAsync(): Promise<void> {
    const resolvedSourceOptions = await this.resolveSourceOptions();
    const submissionConfig = await this.formatSubmissionConfig(this.options, resolvedSourceOptions);

    printSummary(
      this.prepareSummaryData(this.options, resolvedSourceOptions),
      'Android Submission Summary',
      SummaryHumanReadableKeys,
      SummaryHumanReadableValues
    );

    await this.startSubmissionAsync(submissionConfig, this.ctx.commandFlags.verbose);
  }

  private async resolveSourceOptions(): Promise<ResolvedSourceOptions> {
    const androidPackage = await getAndroidPackageAsync(this.options.androidPackageSource);
    const archive = await getArchiveAsync(SubmissionPlatform.Android, this.options.archiveSource);
    const serviceAccountPath = await getServiceAccountAsync(this.options.serviceAccountSource);
    return {
      androidPackage,
      archive,
      serviceAccountPath,
    };
  }

  private async formatSubmissionConfig(
    options: AndroidSubmissionOptions,
    { archive, androidPackage, serviceAccountPath }: ResolvedSourceOptions
  ): Promise<AndroidSubmissionConfig> {
    const serviceAccount = await fs.readFile(serviceAccountPath, 'utf-8');
    const { track, releaseStatus, projectId } = options;

    // structuring order affects table rows order
    return {
      androidPackage,
      archiveUrl: archive.location,
      archiveType: archive.type as AndroidArchiveType,
      track,
      releaseStatus,
      projectId,
      serviceAccount,
    };
  }

  private prepareSummaryData(
    options: AndroidSubmissionOptions,
    { archive, androidPackage, serviceAccountPath }: ResolvedSourceOptions
  ): Summary {
    const { projectId, track, releaseStatus } = options;

    return {
      projectId,
      androidPackage,
      track,
      releaseStatus,
      archiveType: archive.type as AndroidArchiveType,
      ...formatArchiveSourceSummary(archive),
      serviceAccountPath,
    };
  }
}

type Summary = {
  androidPackage: string;
  archiveType: ArchiveType;
  serviceAccountPath: string;
  track: ReleaseTrack;
  releaseStatus?: ReleaseStatus;
  projectId?: string;
} & ArchiveSourceSummaryFields;

const SummaryHumanReadableKeys: Record<keyof Summary, string> = {
  androidPackage: 'Android package',
  archivePath: 'Archive path',
  archiveUrl: 'Download URL',
  archiveType: 'Archive type',
  buildId: 'Build ID',
  serviceAccountPath: 'Google Service Account',
  track: 'Release track',
  releaseStatus: 'Release status',
  projectId: 'Project ID',
};

const SummaryHumanReadableValues: Partial<Record<keyof Summary, Function>> = {};

export default AndroidSubmitter;
