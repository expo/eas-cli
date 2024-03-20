import { Platform } from '@expo/eas-build-job';
import chalk from 'chalk';

import {
  ServiceAccountKeyResult,
  ServiceAccountSource,
  getServiceAccountKeyResultAsync,
} from './ServiceAccountSource';
import { SubmissionEvent } from '../../analytics/AnalyticsManager';
import {
  AndroidSubmissionConfigInput,
  SubmissionAndroidReleaseStatus,
  SubmissionAndroidTrack,
  SubmissionFragment,
} from '../../graphql/generated';
import { SubmissionMutation } from '../../graphql/mutations/SubmissionMutation';
import formatFields from '../../utils/formatFields';
import { ArchiveSource, ResolvedArchiveSource } from '../ArchiveSource';
import BaseSubmitter, { SubmissionInput } from '../BaseSubmitter';
import { SubmissionContext } from '../context';
import {
  ArchiveSourceSummaryFields,
  formatArchiveSourceSummary,
  printSummary,
} from '../utils/summary';

export interface AndroidSubmissionOptions
  extends Pick<
    AndroidSubmissionConfigInput,
    'track' | 'releaseStatus' | 'changesNotSentForReview' | 'rollout'
  > {
  projectId: string;
  archiveSource: ArchiveSource;
  serviceAccountSource: ServiceAccountSource;
}

interface ResolvedSourceOptions {
  archive: ResolvedArchiveSource;
  serviceAccountKeyResult: ServiceAccountKeyResult;
}

export default class AndroidSubmitter extends BaseSubmitter<
  Platform.ANDROID,
  ResolvedSourceOptions,
  AndroidSubmissionOptions
> {
  constructor(
    ctx: SubmissionContext<Platform.ANDROID>,
    options: AndroidSubmissionOptions,
    archive: ResolvedArchiveSource
  ) {
    const sourceOptionsResolver = {
      // eslint-disable-next-line async-protect/async-suffix
      archive: async () => archive,
      // eslint-disable-next-line async-protect/async-suffix
      serviceAccountKeyResult: async () => {
        return await getServiceAccountKeyResultAsync(this.ctx, this.options.serviceAccountSource);
      },
    };
    const sourceOptionsAnalytics = {
      archive: {
        attemptEvent: SubmissionEvent.GATHER_ARCHIVE_ATTEMPT,
        successEvent: SubmissionEvent.GATHER_ARCHIVE_SUCCESS,
        failureEvent: SubmissionEvent.GATHER_ARCHIVE_FAIL,
      },
      serviceAccountKeyResult: {
        attemptEvent: SubmissionEvent.GATHER_CREDENTIALS_ATTEMPT,
        successEvent: SubmissionEvent.GATHER_CREDENTIALS_SUCCESS,
        failureEvent: SubmissionEvent.GATHER_CREDENTIALS_FAIL,
      },
    };
    super(ctx, options, sourceOptionsResolver, sourceOptionsAnalytics);
  }

  public async createSubmissionInputAsync(
    resolvedSourceOptions: ResolvedSourceOptions
  ): Promise<SubmissionInput<Platform.ANDROID>> {
    const submissionConfig = this.formatSubmissionConfig(this.options, resolvedSourceOptions);

    printSummary(
      this.prepareSummaryData(this.options, resolvedSourceOptions),
      SummaryHumanReadableKeys
    );
    return {
      projectId: this.options.projectId,
      submissionConfig,
      ...this.formatArchive(resolvedSourceOptions.archive),
    };
  }

  protected async createPlatformSubmissionAsync({
    projectId,
    submissionConfig,
    buildId,
    archiveSource,
  }: SubmissionInput<Platform.ANDROID>): Promise<SubmissionFragment> {
    return await SubmissionMutation.createAndroidSubmissionAsync(this.ctx.graphqlClient, {
      appId: projectId,
      config: submissionConfig,
      submittedBuildId: buildId,
      archiveSource,
    });
  }

  private formatSubmissionConfig(
    options: AndroidSubmissionOptions,
    { serviceAccountKeyResult }: ResolvedSourceOptions
  ): AndroidSubmissionConfigInput {
    const { track, releaseStatus, changesNotSentForReview, rollout } = options;
    return {
      track,
      changesNotSentForReview,
      releaseStatus,
      rollout,
      isVerboseFastlaneEnabled: this.ctx.isVerboseFastlaneEnabled,
      ...serviceAccountKeyResult.result,
    };
  }

  private prepareSummaryData(
    options: AndroidSubmissionOptions,
    { archive, serviceAccountKeyResult }: ResolvedSourceOptions
  ): SummaryData {
    const { projectId, track, releaseStatus, changesNotSentForReview, rollout } = options;

    // structuring order affects table rows order
    return {
      projectId,
      track,
      changesNotSentForReview: changesNotSentForReview ?? undefined,
      releaseStatus: releaseStatus ?? undefined,
      formattedServiceAccount: formatServiceAccountSummary(serviceAccountKeyResult),
      rollout: rollout ?? undefined,
      ...formatArchiveSourceSummary(archive),
    };
  }
}

type SummaryData = {
  changesNotSentForReview?: boolean;
  formattedServiceAccount: string;
  projectId: string;
  releaseStatus?: SubmissionAndroidReleaseStatus;
  rollout?: number;
  track: SubmissionAndroidTrack;
} & ArchiveSourceSummaryFields;

const SummaryHumanReadableKeys: Record<keyof SummaryData, string> = {
  archivePath: 'Archive path',
  archiveUrl: 'Download URL',
  changesNotSentForReview: 'Changes not sent for a review',
  formattedBuild: 'Build',
  formattedServiceAccount: 'Google Service Account Key',
  projectId: 'Project ID',
  releaseStatus: 'Release status',
  rollout: 'Rollout',
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
      label: 'Account Email',
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
