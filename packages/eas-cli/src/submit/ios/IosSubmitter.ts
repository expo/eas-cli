import { Platform } from '@expo/eas-build-job';
import chalk from 'chalk';

import {
  AppSpecificPasswordCredentials,
  AppSpecificPasswordSource,
  getAppSpecificPasswordLocallyAsync,
} from './AppSpecificPasswordSource';
import {
  AscApiKeyFromExpoServers,
  AscApiKeyResult,
  AscApiKeySource,
  getAscApiKeyResultAsync,
} from './AscApiKeySource';
import { SubmissionEvent } from '../../analytics/AnalyticsManager';
import { MinimalAscApiKey } from '../../credentials/ios/credentials';
import { IosSubmissionConfigInput, SubmissionFragment } from '../../graphql/generated';
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

export interface IosSubmissionOptions
  extends Pick<IosSubmissionConfigInput, 'appleIdUsername' | 'ascAppIdentifier'> {
  projectId: string;
  archiveSource: ArchiveSource;
  appSpecificPasswordSource?: AppSpecificPasswordSource;
  ascApiKeySource?: AscApiKeySource;
  isVerboseFastlaneEnabled?: boolean;
}

interface ResolvedSourceOptions {
  archive: ResolvedArchiveSource;
  credentials: {
    appSpecificPassword?: AppSpecificPasswordCredentials;
    ascApiKeyResult?: AscApiKeyResult;
  };
}

export default class IosSubmitter extends BaseSubmitter<
  Platform.IOS,
  ResolvedSourceOptions,
  IosSubmissionOptions
> {
  constructor(
    ctx: SubmissionContext<Platform.IOS>,
    options: IosSubmissionOptions,
    archive: ResolvedArchiveSource
  ) {
    const sourceOptionsResolver = {
      // eslint-disable-next-line async-protect/async-suffix
      archive: async () => archive,
      // eslint-disable-next-line async-protect/async-suffix
      credentials: async () => {
        const maybeAppSpecificPassword = this.options.appSpecificPasswordSource
          ? await getAppSpecificPasswordLocallyAsync(
              this.ctx,
              this.options.appSpecificPasswordSource
            )
          : null;
        const maybeAppStoreConnectApiKey = this.options.ascApiKeySource
          ? await getAscApiKeyResultAsync(this.ctx, this.options.ascApiKeySource)
          : null;
        return {
          ...(maybeAppSpecificPassword ? { appSpecificPassword: maybeAppSpecificPassword } : null),
          ...(maybeAppStoreConnectApiKey ? { ascApiKeyResult: maybeAppStoreConnectApiKey } : null),
        };
      },
    };
    const sourceOptionsAnalytics = {
      archive: {
        attemptEvent: SubmissionEvent.GATHER_ARCHIVE_ATTEMPT,
        successEvent: SubmissionEvent.GATHER_ARCHIVE_SUCCESS,
        failureEvent: SubmissionEvent.GATHER_ARCHIVE_FAIL,
      },
      credentials: {
        attemptEvent: SubmissionEvent.GATHER_CREDENTIALS_ATTEMPT,
        successEvent: SubmissionEvent.GATHER_CREDENTIALS_SUCCESS,
        failureEvent: SubmissionEvent.GATHER_CREDENTIALS_FAIL,
      },
    };
    super(ctx, options, sourceOptionsResolver, sourceOptionsAnalytics);
  }

  public async createSubmissionInputAsync(
    resolvedSourceOptions: ResolvedSourceOptions
  ): Promise<SubmissionInput<Platform.IOS>> {
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
  }: SubmissionInput<Platform.IOS>): Promise<SubmissionFragment> {
    return await SubmissionMutation.createIosSubmissionAsync(this.ctx.graphqlClient, {
      appId: projectId,
      config: submissionConfig,
      submittedBuildId: buildId,
      archiveSource,
    });
  }

  private formatSubmissionConfig(
    options: IosSubmissionOptions,
    { credentials }: ResolvedSourceOptions
  ): IosSubmissionConfigInput {
    const { appSpecificPassword, ascApiKeyResult } = credentials;
    const { appleIdUsername, ascAppIdentifier } = options;
    const { isVerboseFastlaneEnabled } = this.ctx;
    return {
      ascAppIdentifier,
      appleIdUsername,
      isVerboseFastlaneEnabled,
      ...(appSpecificPassword ? this.formatAppSpecificPassword(appSpecificPassword) : null),
      ...(ascApiKeyResult?.result ? this.formatAscApiKeyResult(ascApiKeyResult.result) : null),
    };
  }

  private formatAppSpecificPassword(
    appSpecificPassword: AppSpecificPasswordCredentials
  ): Pick<IosSubmissionConfigInput, 'appleAppSpecificPassword' | 'appleIdUsername'> {
    return {
      appleAppSpecificPassword: appSpecificPassword.password,
      appleIdUsername: appSpecificPassword.appleIdUsername,
    };
  }

  private formatAscApiKeyResult(
    result: MinimalAscApiKey | AscApiKeyFromExpoServers
  ): Pick<IosSubmissionConfigInput, 'ascApiKey'> | Pick<IosSubmissionConfigInput, 'ascApiKeyId'> {
    return 'ascApiKeyId' in result
      ? { ascApiKeyId: result.ascApiKeyId }
      : {
          ascApiKey: {
            keyP8: result.keyP8,
            keyIdentifier: result.keyId,
            issuerIdentifier: result.issuerId,
          },
        };
  }

  private prepareSummaryData(
    options: IosSubmissionOptions,
    { archive, credentials }: ResolvedSourceOptions
  ): SummaryData {
    const { ascApiKeyResult, appSpecificPassword } = credentials;
    const { ascAppIdentifier, projectId } = options;

    // structuring order affects table rows order
    return {
      ascAppIdentifier,
      projectId,
      ...(appSpecificPassword ? { appleIdUsername: appSpecificPassword.appleIdUsername } : null),
      ...(ascApiKeyResult ? { formattedAscApiKey: formatAscApiKeySummary(ascApiKeyResult) } : null),
      ...formatArchiveSourceSummary(archive),
    };
  }
}

type SummaryData = {
  ascAppIdentifier: string;
  appleIdUsername?: string;
  projectId: string;
  formattedAscApiKey?: string;
} & ArchiveSourceSummaryFields;

const SummaryHumanReadableKeys: Record<keyof SummaryData, string> = {
  ascAppIdentifier: 'ASC App ID',
  appleIdUsername: 'Apple ID',
  projectId: 'Project ID',
  archiveUrl: 'Archive URL',
  archivePath: 'Archive Path',
  formattedBuild: 'Build',
  formattedAscApiKey: 'App Store Connect API Key',
};

function formatAscApiKeySummary({ summary }: AscApiKeyResult): string {
  const { source, path, keyId, name } = summary;

  const fields = [
    {
      label: 'Key Name',
      value: name,
    },
    {
      label: 'Key ID',
      value: keyId,
    },
    {
      label: 'Key Source',
      value: source,
    },
    {
      label: 'Key Path',
      value: path,
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
