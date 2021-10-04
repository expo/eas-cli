import { Platform } from '@expo/eas-build-job';

import {
  AndroidSubmissionConfigInput,
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
import {
  ServiceAccountKeyResult,
  ServiceAccountSource,
  getServiceAccountKeyResultAsync,
} from './ServiceAccountSource';

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
  serviceAccountKeyResult: ServiceAccountKeyResult;
}

export default class AndroidSubmitter extends BaseSubmitter<
  Platform.ANDROID,
  AndroidSubmissionOptions
> {
  async submitAsync(): Promise<SubmissionFragment> {
    const resolvedSourceOptions = await this.resolveSourceOptionsAsync();
    const submissionConfig = await this.formatSubmissionConfigAsync(
      this.options,
      resolvedSourceOptions
    );

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
  }: SubmissionInput<Platform.ANDROID>): Promise<SubmissionFragment> {
    return await SubmissionMutation.createAndroidSubmissionAsync({
      appId: projectId,
      config: submissionConfig,
      submittedBuildId: buildId,
    });
  }

  private async resolveSourceOptionsAsync(): Promise<ResolvedSourceOptions> {
    const androidPackage = await getAndroidPackageAsync(this.options.androidPackageSource);
    const archive = await getArchiveAsync(this.options.archiveSource);
    const serviceAccountKeyResult = await getServiceAccountKeyResultAsync(
      this.ctx,
      this.options.serviceAccountSource,
      androidPackage
    );
    return {
      androidPackage,
      archive,
      serviceAccountKeyResult,
    };
  }

  private async formatSubmissionConfigAsync(
    options: AndroidSubmissionOptions,
    { archive, androidPackage, serviceAccountKeyResult }: ResolvedSourceOptions
  ): Promise<AndroidSubmissionConfigInput> {
    const { track, releaseStatus, changesNotSentForReview } = options;
    return {
      applicationIdentifier: androidPackage,
      archiveUrl: archive.url,
      track,
      changesNotSentForReview,
      releaseStatus,
      ...serviceAccountKeyResult.result,
    };
  }

  private prepareSummaryData(
    options: AndroidSubmissionOptions,
    { archive, androidPackage, serviceAccountKeyResult }: ResolvedSourceOptions
  ): SummaryData {
    const { projectId, track, releaseStatus, changesNotSentForReview } = options;
    const {
      email: serviceAccountEmail,
      path: serviceAccountKeyPath,
      source: serviceAccountKeySource,
    } = serviceAccountKeyResult.summary;

    // structuring order affects table rows order
    return {
      projectId,
      androidPackage,
      track,
      changesNotSentForReview: changesNotSentForReview ?? undefined,
      releaseStatus: releaseStatus ?? undefined,
      serviceAccountEmail,
      serviceAccountKeySource,
      serviceAccountKeyPath,
      ...formatArchiveSourceSummary(archive),
    };
  }
}

type SummaryData = {
  androidPackage: string;
  changesNotSentForReview?: boolean;
  projectId: string;
  releaseStatus?: SubmissionAndroidReleaseStatus;
  serviceAccountKeySource: string;
  serviceAccountKeyPath?: string;
  serviceAccountEmail: string;
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
  serviceAccountKeySource: 'Google Service Key Source',
  serviceAccountKeyPath: 'Google Service Key Path',
  serviceAccountEmail: 'Google Service Account',
  track: 'Release track',
};
