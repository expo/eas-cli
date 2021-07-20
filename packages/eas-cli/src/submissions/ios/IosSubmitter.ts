import chalk from 'chalk';

import { AppPlatform, SubmissionStatus } from '../../graphql/generated';
import Log, { learnMore } from '../../log';
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
  protected readonly appStoreName: string = 'Apple App Store';

  constructor(ctx: IosSubmissionContext, options: IosSubmissionOptions) {
    super(AppPlatform.Ios, ctx, options);
  }

  async submitAsync(): Promise<void> {
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

    const result = await this.startSubmissionAsync(
      submissionConfig,
      resolvedSourceOptions.archive.submittedBuildDetails?.buildId,
      this.ctx.commandFlags.verbose
    );

    if (result === SubmissionStatus.Finished) {
      Log.addNewLineIfNone();
      Log.log(
        chalk.bold('Your binary has been successfully uploaded to App Store Connect!\n') +
          '- It is now being processed by Apple - you will receive an e-mail when the processing finishes.\n' +
          '- It usually takes about 5-10 minutes depending on how busy Apple servers are.\n' +
          '- When it’s done, you can see your build here' +
          learnMore(
            `https://appstoreconnect.apple.com/apps/${this.options.ascAppId}/appstore/ios`,
            { learnMoreMessage: '' }
          )
      );
    }
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
  buildId: 'Build ID',
};

const SummaryHumanReadableValues: Partial<Record<keyof SummaryData, Function>> = {};

export default IosSubmitter;
