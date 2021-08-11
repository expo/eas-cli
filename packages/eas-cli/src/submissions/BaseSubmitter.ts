import { getConfig } from '@expo/config';
import chalk from 'chalk';
import ora from 'ora';

import { getExpoWebsiteBaseUrl } from '../api';
import { AppPlatform, SubmissionFragment, SubmissionStatus } from '../graphql/generated';
import Log from '../log';
import { getProjectAccountNameAsync } from '../project/projectUtils';
import { sleep } from '../utils/promise';
import SubmissionService, {
  DEFAULT_CHECK_INTERVAL_MS,
  SubmissionConfig,
} from './SubmissionService';
import { BaseSubmissionContext } from './types';
import { displayLogs } from './utils/logs';

abstract class BaseSubmitter<SubmissionContext extends BaseSubmissionContext, SubmissionOptions> {
  protected abstract readonly appStoreName: string;

  protected constructor(
    private platform: AppPlatform,
    protected ctx: SubmissionContext,
    protected options: SubmissionOptions
  ) {}

  public abstract submitAsync(): Promise<void>;

  protected async startSubmissionAsync(
    submissionConfig: SubmissionConfig,
    buildId?: string,
    verbose: boolean = false
  ): Promise<SubmissionStatus> {
    Log.addNewLineIfNone();
    const scheduleSpinner = ora('Scheduling submission').start();
    let submissionId: string;
    try {
      submissionId = await SubmissionService.startSubmissionAsync(
        this.platform,
        submissionConfig.projectId,
        submissionConfig,
        buildId
      );
      scheduleSpinner.succeed();
    } catch (err) {
      scheduleSpinner.fail('Failed to schedule submission');
      throw err;
    }

    const projectUrl = await this.getProjectUrlAsync();
    const submissionUrl = `${projectUrl}/submissions/${submissionId}`;

    Log.newLine();
    Log.log(`Submission details: ${chalk.underline(submissionUrl)}`);
    Log.log(`Waiting for submission to finish. You can press Ctrl + C to exit`);
    Log.newLine();

    let submissionCompleted = false;
    let submissionStatus: SubmissionStatus | null = null;
    let submission: SubmissionFragment | null = null;
    const submissionSpinner = ora(`Submitting your app to ${this.appStoreName}`).start();

    try {
      while (!submissionCompleted) {
        await sleep(DEFAULT_CHECK_INTERVAL_MS);
        submission = await SubmissionService.getSubmissionAsync(submissionId);
        submissionStatus = submission.status;

        submissionSpinner.text = this.getStatusText(submissionStatus);

        if (submissionStatus === SubmissionStatus.Errored) {
          submissionCompleted = true;
          process.exitCode = 1;
          submissionSpinner.fail();
        } else if (submissionStatus === SubmissionStatus.Finished) {
          submissionCompleted = true;
          submissionSpinner.succeed();
        }
      }
    } catch (err) {
      submissionSpinner.fail(this.getStatusText(SubmissionStatus.Errored));
      throw err;
    }

    await displayLogs(submission, submissionStatus, verbose);
    return submissionStatus ?? SubmissionStatus.Errored;
  }

  private getStatusText(status: SubmissionStatus): string {
    if (status === SubmissionStatus.InQueue) {
      return `Submitting your app to ${this.appStoreName}: waiting for an available submitter`;
    } else if (status === SubmissionStatus.InProgress) {
      return `Submitting your app to ${this.appStoreName}: submission in progress`;
    } else if (status === SubmissionStatus.Finished) {
      return `Submitted your app to ${this.appStoreName}!`;
    } else if (status === SubmissionStatus.Errored) {
      return `Something went wrong when submitting your app to ${this.appStoreName}.`;
    } else {
      throw new Error('This should never happen');
    }
  }

  private async getProjectUrlAsync(): Promise<string> {
    const projectDir = this.ctx.projectDir;
    const { exp } = getConfig(projectDir, { skipSDKVersionRequirement: true });
    const accountName = await getProjectAccountNameAsync(exp);
    const projectName = exp.slug;

    const submissionUrl = `${getExpoWebsiteBaseUrl()}/accounts/${accountName}/projects/${projectName}`;
    return submissionUrl;
  }
}

export default BaseSubmitter;
