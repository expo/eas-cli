import { Platform } from '@expo/eas-build-job';
import ora from 'ora';

import {
  AndroidSubmissionConfigInput,
  IosSubmissionConfigInput,
  SubmissionFragment,
} from '../graphql/generated';
import Log from '../log';
import { SubmissionContext } from './types';

export interface SubmissionInput<P extends Platform> {
  projectId: string;
  submissionConfig: P extends Platform.ANDROID
    ? AndroidSubmissionConfigInput
    : IosSubmissionConfigInput;
  buildId?: string;
}
export default abstract class BaseSubmitter<P extends Platform, SubmissionOptions> {
  constructor(protected ctx: SubmissionContext<P>, protected options: SubmissionOptions) {}

  public abstract submitAsync(): Promise<SubmissionFragment>;

  protected async createSubmissionAsync(
    submissionInput: SubmissionInput<P>
  ): Promise<SubmissionFragment> {
    Log.addNewLineIfNone();
    const scheduleSpinner = ora('Scheduling submission').start();
    try {
      const submission = this.createPlatformSubmissionAsync(submissionInput);
      scheduleSpinner.succeed();
      return submission;
    } catch (err) {
      scheduleSpinner.fail('Failed to schedule submission');
      throw err;
    }
  }

  protected abstract createPlatformSubmissionAsync(
    input: SubmissionInput<P>
  ): Promise<SubmissionFragment>;
}
