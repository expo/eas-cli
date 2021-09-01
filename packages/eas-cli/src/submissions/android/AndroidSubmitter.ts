import fs from 'fs-extra';

import { AppPlatform, SubmissionFragment } from '../../graphql/generated';
import { Archive, ArchiveSource, getArchiveAsync } from '../ArchiveSource';
import BaseSubmitter from '../BaseSubmitter';
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

export default class AndroidSubmitter extends BaseSubmitter<
  AppPlatform.Android,
  AndroidSubmissionOptions
> {
  async submitAsync(): Promise<SubmissionFragment> {
    const resolvedSourceOptions = await this.resolveSourceOptions();
    const submissionConfig = await this.formatSubmissionConfig(this.options, resolvedSourceOptions);

    printSummary(
      this.prepareSummaryData(this.options, resolvedSourceOptions),
      SummaryHumanReadableKeys
    );

    return await this.createSubmissionAsync(
      submissionConfig,
      resolvedSourceOptions.archive.build?.id
    );
  }

  private async resolveSourceOptions(): Promise<ResolvedSourceOptions> {
    const androidPackage = await getAndroidPackageAsync(this.options.androidPackageSource);
    const archive = await getArchiveAsync(this.options.archiveSource);
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
      archiveUrl: archive.url,
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
      serviceAccountPath,
      ...formatArchiveSourceSummary(archive),
    };
  }
}

type Summary = {
  androidPackage: string;
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
  serviceAccountPath: 'Google Service Key',
  changesNotSentForReview: 'Changes not sent for a review',
  track: 'Release track',
  releaseStatus: 'Release status',
  projectId: 'Project ID',
  formattedBuild: 'Build',
};
