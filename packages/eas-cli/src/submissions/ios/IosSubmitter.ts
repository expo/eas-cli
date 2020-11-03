import ora from 'ora';

import { sleep } from '../../utils/promise';
import SubmissionService, { DEFAULT_CHECK_INTERVAL_MS } from '../SubmissionService';
import { Submission, SubmissionStatus } from '../SubmissionService.types';
import { Archive, ArchiveSource, getArchiveAsync } from '../archive-source';
import { IosSubmissionContext, SubmissionPlatform } from '../types';
import { displayLogs } from '../utils/logs';
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

class IosSubmitter {
  constructor(private ctx: IosSubmissionContext, private options: IosSubmissionOptions) {}

  async submitAsync(): Promise<void> {
    const resolvedSourceOptions = await this.resolveSourceOptions();
    const submissionConfig = await this.formatSubmissionConfigAsync(
      this.options,
      resolvedSourceOptions
    );
    await this.startSubmissionAsync(submissionConfig, this.ctx.commandFlags.verbose);
  }

  // TODO: Temp - change public to private
  public async startSubmissionAsync(
    submissionConfig: IosSubmissionConfig,
    verbose: boolean = false
  ): Promise<void> {
    const scheduleSpinner = ora('Scheduling submission').start();
    let submissionId: string;
    try {
      submissionId = await SubmissionService.startSubmissionAsync(
        SubmissionPlatform.iOS,
        submissionConfig.projectId,
        submissionConfig
      );
      scheduleSpinner.succeed();
    } catch (err) {
      scheduleSpinner.fail('Failed to schedule submission');
      throw err;
    }

    let submissionCompleted = false;
    let submissionStatus: SubmissionStatus | null = null;
    let submission: Submission | null = null;
    const submissionSpinner = ora('Submitting your app to Apple TestFlight').start();
    try {
      while (!submissionCompleted) {
        await sleep(DEFAULT_CHECK_INTERVAL_MS);
        submission = await SubmissionService.getSubmissionAsync(
          submissionConfig.projectId,
          submissionId
        );
        submissionSpinner.text = IosSubmitter.getStatusText(submission.status);
        submissionStatus = submission.status;
        if (submissionStatus === SubmissionStatus.ERRORED) {
          submissionCompleted = true;
          process.exitCode = 1;
          submissionSpinner.fail();
        } else if (submissionStatus === SubmissionStatus.FINISHED) {
          submissionCompleted = true;
          submissionSpinner.succeed();
        }
      }
    } catch (err) {
      submissionSpinner.fail(IosSubmitter.getStatusText(SubmissionStatus.ERRORED));
      throw err;
    }

    await displayLogs(submission, submissionStatus, verbose);
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

  private static getStatusText(status: SubmissionStatus): string {
    if (status === SubmissionStatus.IN_QUEUE) {
      return 'Submitting your app to Apple TestFlight: waiting for an available submitter';
    } else if (status === SubmissionStatus.IN_PROGRESS) {
      return 'Submitting your app to Apple TestFlight: submission in progress';
    } else if (status === SubmissionStatus.FINISHED) {
      return 'Successfully submitted your app to Apple TestFlight!';
    } else if (status === SubmissionStatus.ERRORED) {
      return 'Something went wrong when submitting your app to Apple TestFlight.';
    } else {
      throw new Error('This should never happen');
    }
  }
}

export default IosSubmitter;
