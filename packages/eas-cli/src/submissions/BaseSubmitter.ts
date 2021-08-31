import { JSONObject } from '@expo/json-file';
import ora from 'ora';

import { AppPlatform, SubmissionFragment } from '../graphql/generated';
import { SubmissionMutation } from '../graphql/mutations/SubmissionMutation';
import Log from '../log';
import { AndroidSubmissionConfig } from './android/AndroidSubmissionConfig';
import { IosSubmissionConfig } from './ios/IosSubmissionConfig';
import { BaseSubmissionContext } from './types';

export default abstract class BaseSubmitter<
  SubmissionContext extends BaseSubmissionContext,
  SubmissionOptions
> {
  protected constructor(
    private platform: AppPlatform,
    protected ctx: SubmissionContext,
    protected options: SubmissionOptions
  ) {}

  public abstract submitAsync(): Promise<SubmissionFragment>;

  protected async createSubmissionAsync(
    submissionConfig: AndroidSubmissionConfig | IosSubmissionConfig,
    buildId?: string
  ): Promise<SubmissionFragment> {
    Log.addNewLineIfNone();
    const scheduleSpinner = ora('Scheduling submission').start();
    try {
      const submission = await SubmissionMutation.createSubmissionAsync({
        appId: submissionConfig.projectId,
        platform: this.platform,
        config: submissionConfig as unknown as JSONObject,
        submittedBuildId: buildId,
      });
      scheduleSpinner.succeed();
      return submission;
    } catch (err) {
      scheduleSpinner.fail('Failed to schedule submission');
      throw err;
    }
  }
}
