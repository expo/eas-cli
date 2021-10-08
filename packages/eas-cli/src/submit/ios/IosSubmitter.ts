import { Platform } from '@expo/eas-build-job';

import { IosSubmissionConfigInput, SubmissionFragment } from '../../graphql/generated';
import { SubmissionMutation } from '../../graphql/mutations/SubmissionMutation';
import { Archive, ArchiveSource, getArchiveAsync } from '../ArchiveSource';
import BaseSubmitter, { SubmissionInput } from '../BaseSubmitter';
import {
  ArchiveSourceSummaryFields,
  formatArchiveSourceSummary,
  printSummary,
} from '../utils/summary';
import {
  AppSpecificPasswordSource,
  getAppSpecificPasswordAsync,
} from './AppSpecificPasswordSource';
import { AscApiKeyResult, AscApiKeySource, getAscApiKeyLocallyAsync } from './AscApiKeySource';

export interface IosSubmissionOptions
  extends Pick<IosSubmissionConfigInput, 'appleIdUsername' | 'ascAppIdentifier'> {
  projectId: string;
  archiveSource: ArchiveSource;
  appSpecificPasswordSource?: AppSpecificPasswordSource;
  ascApiKeySource?: AscApiKeySource;
}

interface ResolvedSourceOptions {
  archive: Archive;
  appSpecificPassword?: string;
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
      ? await getAppSpecificPasswordAsync(this.options.appSpecificPasswordSource)
      : null;
    const maybeAppStoreConnectApiKey = this.options.ascApiKeySource
      ? await getAscApiKeyLocallyAsync(this.options.ascApiKeySource)
      : null;
    return {
      archive,
      ...(maybeAppSpecificPassword ? { appSpecificPassword: maybeAppSpecificPassword } : null),
      ...(maybeAppStoreConnectApiKey ? { ascApiKeyResult: maybeAppStoreConnectApiKey } : null),
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
      appleAppSpecificPassword: appSpecificPassword,
      ...(ascApiKeyResult?.result
        ? {
            ascApiKey: {
              keyP8: ascApiKeyResult?.result.keyP8,
              keyIdentifier: ascApiKeyResult?.result.keyId,
              issuerIdentifier: ascApiKeyResult?.result.issuerId,
            },
          }
        : null),
    };
  }

  private prepareSummaryData(
    options: IosSubmissionOptions,
    { archive, ascApiKeyResult }: ResolvedSourceOptions
  ): SummaryData {
    const { appleIdUsername, ascAppIdentifier, projectId } = options;
    const ascApiKeySummary = ascApiKeyResult?.summary;

    // structuring order affects table rows order
    return {
      ascAppIdentifier,
      appleIdUsername,
      projectId,
      ...(ascApiKeySummary
        ? { ascApiKeySource: ascApiKeySummary.source, ascApiKeyId: ascApiKeySummary.keyId }
        : null),
      ...(ascApiKeySummary?.path ? { ascApiKeyPath: ascApiKeySummary.path } : null),
      ...formatArchiveSourceSummary(archive),
    };
  }
}

type SummaryData = {
  ascAppIdentifier: string;
  appleIdUsername: string;
  projectId: string;
  ascApiKeySource?: string;
  ascApiKeyPath?: string;
  ascApiKeyId?: string;
} & ArchiveSourceSummaryFields;

const SummaryHumanReadableKeys: Record<keyof SummaryData, string> = {
  ascAppIdentifier: 'ASC App ID',
  appleIdUsername: 'Apple ID',
  projectId: 'Project ID',
  archiveUrl: 'Archive URL',
  archivePath: 'Archive Path',
  formattedBuild: 'Build',
  ascApiKeySource: 'App Store Connect Api Key Source',
  ascApiKeyPath: 'App Store Connect Api Key Path',
  ascApiKeyId: 'App Store Connect Api Key ID',
};
