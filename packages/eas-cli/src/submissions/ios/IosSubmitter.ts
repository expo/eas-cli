import chalk from 'chalk';

import BaseSubmitter from '../BaseSubmitter';
import { Archive, ArchiveSource, getArchiveAsync } from '../archive-source';
import { IosSubmissionContext, SubmissionPlatform } from '../types';
import { breakWord, printSummary } from '../utils/summary';
import {
  AppSpecificPasswordSource,
  getAppSpecificPasswordAsync,
} from './AppSpecificPasswordSource';
import { IosSubmissionConfig } from './IosSubmissionConfig';

export interface IosSubmissionOptions
  extends Pick<IosSubmissionConfig, 'projectId' | 'appleId' | 'appAppleId'> {
  archiveSource: ArchiveSource;
  appSpecificPasswordSource: AppSpecificPasswordSource;
}

interface ResolvedSourceOptions {
  archive: Archive;
  appSpecificPassword: string;
}

class IosSubmitter extends BaseSubmitter<IosSubmissionContext, IosSubmissionOptions> {
  protected readonly appStoreName: string = 'Apple App Store';

  constructor(ctx: IosSubmissionContext, options: IosSubmissionOptions) {
    super(SubmissionPlatform.iOS, ctx, options);
  }

  async submitAsync(): Promise<void> {
    const resolvedSourceOptions = await this.resolveSourceOptions();
    const submissionConfig = await this.formatSubmissionConfigAsync(
      this.options,
      resolvedSourceOptions
    );

    printSummary(
      submissionConfig,
      'iOS Submission Summary',
      SummaryHumanReadableKeys,
      SummaryHumanReadableValues
    );
    await this.startSubmissionAsync(submissionConfig, this.ctx.commandFlags.verbose);
  }

  private async resolveSourceOptions(): Promise<ResolvedSourceOptions> {
    const archive = await getArchiveAsync(SubmissionPlatform.iOS, this.options.archiveSource);
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
    const { projectId, appleId, appAppleId } = options;
    const submissionConfig = {
      archiveUrl: archive.location,
      appleId,
      appSpecificPassword,
      appAppleId,
      projectId,
    };
    return submissionConfig;
  }
}

const SummaryHumanReadableKeys: Record<keyof IosSubmissionConfig, string> = {
  appleId: 'Apple ID',
  archiveUrl: 'Archive URL',
  appSpecificPassword: 'Apple app-specific password',
  appAppleId: ' App Store Connect Apple ID number',
  projectId: 'Project ID',
};

const SummaryHumanReadableValues: Partial<Record<keyof IosSubmissionConfig, Function>> = {
  archiveUrl: (url: string) => breakWord(url, 50),
  appSpecificPassword: () => chalk.italic('[hidden]'),
};

export default IosSubmitter;
