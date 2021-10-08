import { Platform } from '@expo/eas-build-job';
import chalk from 'chalk';

import {
  AndroidSubmissionConfigInput,
  SubmissionAndroidReleaseStatus,
  SubmissionAndroidTrack,
  SubmissionFragment,
} from '../../graphql/generated';
import { SubmissionMutation } from '../../graphql/mutations/SubmissionMutation';
import formatFields from '../../utils/formatFields';
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

    // structuring order affects table rows order
    return {
      projectId,
      androidPackage,
      track,
      changesNotSentForReview: changesNotSentForReview ?? undefined,
      releaseStatus: releaseStatus ?? undefined,
      formattedServiceAccount: formatServiceAccountSummary(serviceAccountKeyResult),
      ...formatArchiveSourceSummary(archive),
    };
  }
}

type SummaryData = {
  androidPackage: string;
  changesNotSentForReview?: boolean;
  formattedServiceAccount: string;
  projectId: string;
  releaseStatus?: SubmissionAndroidReleaseStatus;
  track: SubmissionAndroidTrack;
} & ArchiveSourceSummaryFields;

const SummaryHumanReadableKeys: Record<keyof SummaryData, string> = {
  androidPackage: 'Android package',
  archivePath: 'Archive path',
  archiveUrl: 'Download URL',
  changesNotSentForReview: 'Changes not sent for a review',
  formattedBuild: 'Build',
  formattedServiceAccount: 'Google Service Account Key',
  projectId: 'Project ID',
  releaseStatus: 'Release status',
  track: 'Release track',
};

function formatServiceAccountSummary({ summary }: ServiceAccountKeyResult): string {
  const {
    email: serviceAccountEmail,
    path: serviceAccountKeyPath,
    source: serviceAccountKeySource,
  } = summary;

  const fields = [
    {
      label: 'Key Source',
      value: serviceAccountKeySource,
    },
    {
      label: 'Key Path',
      value: serviceAccountKeyPath,
    },
    {
      label: 'Account E-mail',
      value: serviceAccountEmail,
    },
  ];

  const filteredFields = fields.filter(({ value }) => value !== undefined && value !== null) as {
    label: string;
    value: string;
  }[];

  return (
    '\n' +
    formatFields(filteredFields, {
      labelFormat: label => `    ${chalk.dim(label)}:`,
    })
  );
}
