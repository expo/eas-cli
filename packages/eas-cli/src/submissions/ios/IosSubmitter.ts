import BaseSubmitter from '../BaseSubmitter';
import { Archive, ArchiveSource, getArchiveAsync } from '../archive-source';
import { IosSubmissionContext, SubmissionPlatform } from '../types';
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
  protected readonly appStoreName: string = 'Apple TestFlight';

  constructor(ctx: IosSubmissionContext, options: IosSubmissionOptions) {
    super(SubmissionPlatform.iOS, ctx, options);
  }

  async submitAsync(): Promise<void> {
    const resolvedSourceOptions = await this.resolveSourceOptions();
    const submissionConfig = await this.formatSubmissionConfigAsync(
      this.options,
      resolvedSourceOptions
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
      projectId,
      appSpecificPassword,
      appAppleId,
      appleId,
    };
    return submissionConfig;
  }
}

export default IosSubmitter;
