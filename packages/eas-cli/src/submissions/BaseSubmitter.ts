import ora from 'ora';

import Log from '../log';
import { sleep } from '../utils/promise';
import SubmissionService, { DEFAULT_CHECK_INTERVAL_MS } from './SubmissionService';
import { Submission, SubmissionConfig, SubmissionStatus } from './SubmissionService.types';
import { SubmissionPlatform } from './types';
import { displayLogs } from './utils/logs';

abstract class BaseSubmitter<SubmissionContext, SubmissionOptions> {
  protected abstract readonly appStoreName: string;

  protected constructor(
    private platform: SubmissionPlatform,
    protected ctx: SubmissionContext,
    protected options: SubmissionOptions
  ) {}

  public abstract submitAsync(): Promise<void>;

  protected async startSubmissionAsync(
    submissionConfig: SubmissionConfig,
    verbose: boolean = false
  ): Promise<SubmissionStatus> {
    Log.addNewLineIfNone();
    const scheduleSpinner = ora('Scheduling submission').start();
    let submissionId: string;
    try {
      submissionId = await SubmissionService.startSubmissionAsync(
        this.platform,
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
    const submissionSpinner = ora(`Submitting your app to ${this.appStoreName}`).start();
    try {
      while (!submissionCompleted) {
        await sleep(DEFAULT_CHECK_INTERVAL_MS);
        submission = await SubmissionService.getSubmissionAsync(
          submissionConfig.projectId,
          submissionId
        );
        submissionSpinner.text = this.getStatusText(submission.status);
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
      submissionSpinner.fail(this.getStatusText(SubmissionStatus.ERRORED));
      throw err;
    }

    await displayLogs(submission, submissionStatus, verbose);
    return submissionStatus ?? SubmissionStatus.ERRORED;
  }

  private getStatusText(status: SubmissionStatus): string {
    if (status === SubmissionStatus.IN_QUEUE) {
      return `Submitting your app to ${this.appStoreName}: waiting for an available submitter`;
    } else if (status === SubmissionStatus.IN_PROGRESS) {
      return `Submitting your app to ${this.appStoreName}: submission in progress`;
    } else if (status === SubmissionStatus.FINISHED) {
      return `Submitted your app to ${this.appStoreName}!`;
    } else if (status === SubmissionStatus.ERRORED) {
      return `Something went wrong when submitting your app to ${this.appStoreName}.`;
    } else {
      throw new Error('This should never happen');
    }
  }
}

export default BaseSubmitter;
