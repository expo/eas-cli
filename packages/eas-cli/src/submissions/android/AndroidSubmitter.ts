import fs from 'fs-extra';

import { AppPlatform, SubmissionFragment } from '../../graphql/generated';
import BaseSubmitter from '../BaseSubmitter';
import { Archive, ArchiveSource, getArchiveAsync } from '../archiveSource';
import { AndroidArchiveType, AndroidSubmissionContext, ArchiveType } from '../types';
import {
  ArchiveSourceSummaryFields,
  formatArchiveSourceSummary,
  printSummary,
} from '../utils/summary';
import { AndroidPackageSource, getAndroidPackageAsync } from './AndroidPackageSource';
import { AndroidSubmissionConfig, ReleaseStatus, ReleaseTrack } from './AndroidSubmissionConfig';
import { ServiceAccountSource, getServiceAccountAsync } from './ServiceAccountSource';

export interface AndroidSubmissionOptions
  extends Pick<
    AndroidSubmissionConfig,
    'track' | 'releaseStatus' | 'projectId' | 'changesNotSentForReview'
  > {
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
  constructor(ctx: AndroidSubmissionContext, options: AndroidSubmissionOptions) {
    super(AppPlatform.Android, ctx, options);
  }

  async submitAsync(): Promise<SubmissionFragment> {
    const resolvedSourceOptions = await this.resolveSourceOptions();
    const submissionConfig = await this.formatSubmissionConfig(this.options, resolvedSourceOptions);

    printSummary(
      this.prepareSummaryData(this.options, resolvedSourceOptions),
      SummaryHumanReadableKeys,
      SummaryHumanReadableValues
    );

    return await this.createSubmissionAsync(
      submissionConfig,
      resolvedSourceOptions.archive.build?.id
    );
  }

  private async resolveSourceOptions(): Promise<ResolvedSourceOptions> {
    const androidPackage = await getAndroidPackageAsync(this.options.androidPackageSource);
    const archive = await getArchiveAsync(AppPlatform.Android, this.options.archiveSource);
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
    const { track, releaseStatus, projectId, changesNotSentForReview } = options;

    return {
      androidPackage,
      archiveUrl: archive.location,
      archiveType: archive.type as AndroidArchiveType,
      track,
      changesNotSentForReview,
      releaseStatus,
      projectId,
      serviceAccount,
    };
  }

  private prepareSummaryData(
    options: AndroidSubmissionOptions,
    { archive, androidPackage, serviceAccountPath }: ResolvedSourceOptions
  ): Summary {
    const { projectId, track, releaseStatus, changesNotSentForReview } = options;

    // structuring order affects table rows order
    return {
      projectId,
      androidPackage,
      track,
      changesNotSentForReview,
      releaseStatus,
      archiveType: archive.type as AndroidArchiveType,
      serviceAccountPath,
      ...formatArchiveSourceSummary(archive),
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
  changesNotSentForReview?: boolean;
} & ArchiveSourceSummaryFields;

const SummaryHumanReadableKeys: Record<keyof Summary, string> = {
  androidPackage: 'Android package',
  archivePath: 'Archive path',
  archiveUrl: 'Download URL',
  archiveType: 'Archive type',
  serviceAccountPath: 'Google Service Key',
  changesNotSentForReview: 'Changes not sent for a review',
  track: 'Release track',
  releaseStatus: 'Release status',
  projectId: 'Project ID',
  formattedBuild: 'Build',
};

const SummaryHumanReadableValues: Partial<Record<keyof Summary, Function>> = {
  archiveType: (type: string) => type.toUpperCase(),
};

export default AndroidSubmitter;
