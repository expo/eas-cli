import { Platform } from '@expo/eas-build-job';
import chalk from 'chalk';

import { MinimalAscApiKey } from '../../credentials/ios/credentials';
import { IosSubmissionConfigInput, SubmissionFragment } from '../../graphql/generated';
import { SubmissionMutation } from '../../graphql/mutations/SubmissionMutation';
import formatFields from '../../utils/formatFields';
import { Archive, ArchiveSource, getArchiveAsync } from '../ArchiveSource';
import BaseSubmitter, { SubmissionInput } from '../BaseSubmitter';
import {
  ArchiveSourceSummaryFields,
  formatArchiveSourceSummary,
  printSummary,
} from '../utils/summary';
import {
  AppSpecificPasswordCredentials,
  AppSpecificPasswordSource,
  getAppSpecificPasswordAsync,
} from './AppSpecificPasswordSource';
import {
  AscApiKeyFromExpoServers,
  AscApiKeyResult,
  AscApiKeySource,
  getAscApiKeyLocallyAsync,
} from './AscApiKeySource';
import {
  CredentialsServiceSource,
  getFromCredentialsServiceAsync,
} from './CredentialsServiceSource';

export interface IosSubmissionOptions
  extends Pick<IosSubmissionConfigInput, 'appleIdUsername' | 'ascAppIdentifier'> {
  projectId: string;
  archiveSource: ArchiveSource;
  appSpecificPasswordSource?: AppSpecificPasswordSource;
  ascApiKeySource?: AscApiKeySource;
  credentialsServiceSource?: CredentialsServiceSource;
}

interface ResolvedSourceOptions {
  archive: Archive;
  appSpecificPassword?: AppSpecificPasswordCredentials;
  ascApiKeyResult?: AscApiKeyResult;
}

export default class IosSubmitter extends BaseSubmitter<Platform.IOS, IosSubmissionOptions> {
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
  }: SubmissionInput<Platform.IOS>): Promise<SubmissionFragment> {
    return await SubmissionMutation.createIosSubmissionAsync({
      appId: projectId,
      config: submissionConfig,
      submittedBuildId: buildId,
    });
  }

  private async resolveSourceOptionsAsync(): Promise<ResolvedSourceOptions> {
    const archive = await getArchiveAsync(this.options.archiveSource);
    const maybeAppSpecificPassword = this.options.appSpecificPasswordSource
      ? await getAppSpecificPasswordAsync(this.ctx, this.options.appSpecificPasswordSource)
      : null;
    const maybeAppStoreConnectApiKey = this.options.ascApiKeySource
      ? await getAscApiKeyLocallyAsync(this.ctx, this.options.ascApiKeySource)
      : null;
    const maybeAscOrAspFromCredentialsService = this.options.credentialsServiceSource
      ? await getFromCredentialsServiceAsync(this.ctx)
      : null;
    return {
      archive,
      ...(maybeAppSpecificPassword ? { appSpecificPassword: maybeAppSpecificPassword } : null),
      ...(maybeAppStoreConnectApiKey ? { ascApiKeyResult: maybeAppStoreConnectApiKey } : null),
      ...(maybeAscOrAspFromCredentialsService ? maybeAscOrAspFromCredentialsService : null),
    };
  }

  private async formatSubmissionConfigAsync(
    options: IosSubmissionOptions,
    { archive, appSpecificPassword, ascApiKeyResult }: ResolvedSourceOptions
  ): Promise<IosSubmissionConfigInput> {
    const { appleIdUsername, ascAppIdentifier } = options;
    return {
      ascAppIdentifier,
      appleIdUsername,
      archiveUrl: archive.url,
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
    { archive, ascApiKeyResult, appSpecificPassword }: ResolvedSourceOptions
  ): SummaryData {
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
  formattedAscApiKey: 'App Store Connect Api Key',
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
