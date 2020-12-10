import chalk from 'chalk';

import BaseSubmitter from '../BaseSubmitter';
import { Archive, ArchiveSource, getArchiveAsync } from '../archiveSource';
import { IosSubmissionContext, SubmissionPlatform } from '../types';
import { printSummary } from '../utils/summary';
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
    const result = await this.startSubmissionAsync(submissionConfig, this.ctx.commandFlags.verbose);

    if (result === SubmissionStatus.FINISHED) {
      log(
        'Your binary has been successfully uploaded to App Store Connect!\n' +
          'It is now being processed by Apple - you will receive an e-mail when the processing finishes.\n' +
          'It usually takes about 5-10 minutes depending on how busy Apple servers are.\n' +
          'When it’s done, you can see your build here: ' +
          chalk.dim.underline(
            `https://appstoreconnect.apple.com/apps/${this.options.ascAppId}/appstore/ios`
          )
      );
    }
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
    const { projectId, appleId, ascAppId } = options;
    const submissionConfig = {
      archiveUrl: archive.location,
      appleId,
      appSpecificPassword,
      appAppleId: ascAppId, //ASC App ID is called "appAppleId" on server side
      projectId,
    };
    return submissionConfig;
  }
}

/**
 * Log the summary as a table. Exported for testing locally.
 * @example
 * printSummaryIOS({
 *   appleId: 'examplename@expo.io',
 *   appSpecificPassword: 'Apple Pie^',
 *   appAppleId: '1234567890',
 *   projectId: '863f9337-65d2-40c6-acb3-c1054c5c09f8',
 *   archiveUrl: 'https://turtle-v2-artifacts.s3.amazonaws.com/ios/6420592d-5b5d-439b-aed4-ccd278647138-ca4145d8468947df9ded737248a1a238.ipa',
 * });
 * @param submissionConfig
 */
export function printSummaryIOS(submissionConfig: IosSubmissionConfig) {
  const { appSpecificPassword, projectId, archiveUrl, ...logConfig } = submissionConfig;

  printSummary(
    { ...logConfig, projectId, archiveUrl },
    SummaryHumanReadableKeys,
    SummaryHumanReadableValues
  );
}

const SummaryHumanReadableKeys: Record<keyof IosSubmissionConfig, string> = {
  appleId: 'Apple ID',
  archiveUrl: 'Download URL',
  appSpecificPassword: 'Apple app-specific password',
  appAppleId: 'ASC App ID',
  projectId: 'Project ID',
};

const SummaryHumanReadableValues: Partial<Record<keyof IosSubmissionConfig, Function>> = {
  appSpecificPassword: () => chalk.italic('[hidden]'),
};

export default IosSubmitter;
