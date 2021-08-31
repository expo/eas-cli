import { AppPlatform, SubmissionFragment } from '../../graphql/generated';
import BaseSubmitter from '../BaseSubmitter';
import { Archive, ArchiveSource, getArchiveAsync } from '../archiveSource';
import { IosSubmissionContext } from '../types';
import {
  ArchiveSourceSummaryFields,
  formatArchiveSourceSummary,
  printSummary,
} from '../utils/summary';
import {
  AppSpecificPasswordSource,
  getAppSpecificPasswordAsync,
} from './AppSpecificPasswordSource';
import { IosSubmissionConfig } from './IosSubmissionConfig';

export interface IosSubmissionOptions extends Pick<IosSubmissionConfig, 'projectId' | 'appleId'> {
  ascAppId: string;
  archiveSource: ArchiveSource;
  appSpecificPasswordSource: AppSpecificPasswordSource;
}

interface ResolvedSourceOptions {
  archive: Archive;
  appSpecificPassword: string;
}

type SummaryData = Pick<IosSubmissionOptions, 'ascAppId' | 'appleId' | 'projectId'> &
  ArchiveSourceSummaryFields;

class IosSubmitter extends BaseSubmitter<IosSubmissionContext, IosSubmissionOptions> {
  constructor(ctx: IosSubmissionContext, options: IosSubmissionOptions) {
    super(AppPlatform.Ios, ctx, options);
  }

  async submitAsync(): Promise<SubmissionFragment> {
    const resolvedSourceOptions = await this.resolveSourceOptions();
    const submissionConfig = await this.formatSubmissionConfigAsync(
      this.options,
      resolvedSourceOptions
    );

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
    const archive = await getArchiveAsync(AppPlatform.Ios, this.options.archiveSource);
    const appSpecificPassword = await getAppSpecificPasswordAsync(
      this.options.appSpecificPasswordSource
    );

    return {
      archive,
      appSpecificPassword,
    };
  }

  private async formatSubmissionConfigAsync(
    options: IosSubmissionOptions,
    { archive, appSpecificPassword }: ResolvedSourceOptions
  ): Promise<IosSubmissionConfig> {
    const { projectId, appleId, ascAppId } = options;
    const submissionConfig = {
      appAppleId: ascAppId, //ASC App ID is called "appAppleId" on server side
      appleId,
      projectId,
      archiveUrl: archive.location,
      appSpecificPassword,
    };
    return submissionConfig;
  }

  private prepareSummaryData(
    options: IosSubmissionOptions,
    { archive }: ResolvedSourceOptions
  ): SummaryData {
    const { appleId, ascAppId, projectId } = options;

    // structuring order affects table rows order
    return {
      ascAppId,
      appleId,
      projectId,
      ...formatArchiveSourceSummary(archive),
    };
  }
}

const SummaryHumanReadableKeys: Record<keyof SummaryData, string> = {
  ascAppId: 'ASC App ID',
  appleId: 'Apple ID',
  projectId: 'Project ID',
  archiveUrl: 'Archive URL',
  archivePath: 'Archive Path',
  formattedBuild: 'Build',
};

const SummaryHumanReadableValues: Partial<Record<keyof SummaryData, Function>> = {};

export default IosSubmitter;
