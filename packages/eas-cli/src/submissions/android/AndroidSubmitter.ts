import fs from 'fs-extra';

import {
  AndroidSubmissionConfigInput,
  AppPlatform,
  SubmissionAndroidReleaseStatus,
  SubmissionAndroidTrack,
  SubmissionFragment,
} from '../../graphql/generated';
import { SubmissionMutation } from '../../graphql/mutations/SubmissionMutation';
import { Archive, ArchiveSource, getArchiveAsync } from '../ArchiveSource';
import BaseSubmitter, { SubmissionInput } from '../BaseSubmitter';
import {
  ArchiveSourceSummaryFields,
  formatArchiveSourceSummary,
  printSummary,
} from '../utils/summary';
import { AndroidPackageSource, getAndroidPackageAsync } from './AndroidPackageSource';
import { ServiceAccountSource, getServiceAccountAsync } from './ServiceAccountSource';

export interface AndroidSubmissionOptions
  extends Pick<
    AndroidSubmissionConfigInput,
    'track' | 'releaseStatus' | 'changesNotSentForReview'
  > {
  projectId: string;
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

    return await this.createSubmissionAsync({
      projectId: this.options.projectId,
      submissionConfig,
      buildId: resolvedSourceOptions.archive.build?.id,
    });
  }

  protected async createPlatformSubmissionAsync({
    projectId,
    submissionConfig,
    buildId,
  }: SubmissionInput<AppPlatform.Android>): Promise<SubmissionFragment> {
    return await SubmissionMutation.createAndroidSubmissionAsync({
      appId: projectId,
      config: submissionConfig,
      submittedBuildId: buildId,
    });
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
  ): Promise<AndroidSubmissionConfigInput> {
    const serviceAccount = await fs.readFile(serviceAccountPath, 'utf-8');
    const { track, releaseStatus, changesNotSentForReview } = options;
    return {
      applicationIdentifier: androidPackage,
      archiveUrl: archive.url,
      track,
      changesNotSentForReview,
      releaseStatus,
      googleServiceAccountKeyJson: serviceAccount,
    };
  }

  private prepareSummaryData(
    options: AndroidSubmissionOptions,
    { archive, androidPackage, serviceAccountPath }: ResolvedSourceOptions
  ): SummaryData {
    const { projectId, track, releaseStatus, changesNotSentForReview } = options;

    // structuring order affects table rows order
    return {
      projectId,
      androidPackage,
      track,
      changesNotSentForReview: changesNotSentForReview ?? undefined,
      releaseStatus: releaseStatus ?? undefined,
      serviceAccountPath,
      ...formatArchiveSourceSummary(archive),
    };
  }
}

type SummaryData = {
  androidPackage: string;
  changesNotSentForReview?: boolean;
  projectId: string;
  releaseStatus?: SubmissionAndroidReleaseStatus;
  serviceAccountPath: string;
  track: SubmissionAndroidTrack;
} & ArchiveSourceSummaryFields;

const SummaryHumanReadableKeys: Record<keyof SummaryData, string> = {
  androidPackage: 'Android package',
  archivePath: 'Archive path',
  archiveUrl: 'Download URL',
  changesNotSentForReview: 'Changes not sent for a review',
  formattedBuild: 'Build',
  projectId: 'Project ID',
  releaseStatus: 'Release status',
  serviceAccountPath: 'Google Service Key',
  track: 'Release track',
};
