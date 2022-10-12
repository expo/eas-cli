import { Platform } from '@expo/eas-build-job';

import { withAnalyticsAsync } from '../analytics/common';
import { Event, SubmissionEvent } from '../analytics/events';
import {
  AndroidSubmissionConfigInput,
  IosSubmissionConfigInput,
  SubmissionFragment,
} from '../graphql/generated';
import { toAppPlatform } from '../graphql/types/AppPlatform';
import Log from '../log';
import { ora } from '../ora';
import { appPlatformDisplayNames } from '../platform';
import { SubmissionContext } from './context';

export interface SubmissionInput<P extends Platform> {
  projectId: string;
  submissionConfig: P extends Platform.ANDROID
    ? AndroidSubmissionConfigInput
    : IosSubmissionConfigInput;
  buildId?: string;
}

interface AnalyticEvents {
  attemptEvent: Event;
  successEvent: Event;
  failureEvent: Event;
}

export default abstract class BaseSubmitter<
  P extends Platform,
  ResolvedSourceOptions,
  SubmissionOptions
> {
  constructor(
    protected ctx: SubmissionContext<P>,
    protected options: SubmissionOptions,
    protected sourceOptionResolver: {
      [K in keyof ResolvedSourceOptions]: () => Promise<ResolvedSourceOptions[K]>;
    },
    protected sourceOptionAnalytics: Record<keyof ResolvedSourceOptions, AnalyticEvents>
  ) {}

  private async getSourceOptionsAsync(): Promise<ResolvedSourceOptions> {
    const resolvedSourceOptions: ResolvedSourceOptions = {} as ResolvedSourceOptions;
    // Do not perform this in parallel as some of these require user interaction
    for (const key in this.sourceOptionResolver) {
      const sourceOptionKey = key as keyof ResolvedSourceOptions;
      const sourceOptionAnalytics = this.sourceOptionAnalytics[sourceOptionKey];

      const sourceOption = await withAnalyticsAsync<
        ResolvedSourceOptions[keyof ResolvedSourceOptions]
      >(async () => await this.sourceOptionResolver[sourceOptionKey](), {
        attemptEvent: sourceOptionAnalytics.attemptEvent,
        successEvent: sourceOptionAnalytics.successEvent,
        failureEvent: sourceOptionAnalytics.failureEvent,
        trackingCtx: this.ctx.trackingCtx,
      });
      resolvedSourceOptions[sourceOptionKey] = sourceOption;
    }
    return resolvedSourceOptions;
  }

  public async submitAsync(): Promise<SubmissionFragment> {
    const resolvedSourceOptions = await this.getSourceOptionsAsync();
    const input = await this.createSubmissionInputAsync(resolvedSourceOptions);
    return await this.createSubmissionWithAnalyticsAsync(input);
  }

  public abstract createSubmissionInputAsync(
    resolvedOptions: ResolvedSourceOptions
  ): Promise<SubmissionInput<P>>;

  private async createSubmissionAsync(
    submissionInput: SubmissionInput<P>
  ): Promise<SubmissionFragment> {
    Log.addNewLineIfNone();
    const platformDisplayName = appPlatformDisplayNames[toAppPlatform(this.ctx.platform)];
    const scheduleSpinner = ora(`Scheduling ${platformDisplayName} submission`).start();
    try {
      const submission = this.createPlatformSubmissionAsync(submissionInput);
      scheduleSpinner.succeed(`Scheduled ${platformDisplayName} submission`);
      return submission;
    } catch (err) {
      scheduleSpinner.fail(`Failed to schedule ${platformDisplayName} submission`);
      throw err;
    }
  }

  private async createSubmissionWithAnalyticsAsync(
    submissionInput: SubmissionInput<P>
  ): Promise<SubmissionFragment> {
    return await withAnalyticsAsync<SubmissionFragment>(
      async () => this.createSubmissionAsync(submissionInput),
      {
        attemptEvent: SubmissionEvent.SUBMIT_REQUEST_ATTEMPT,
        successEvent: SubmissionEvent.SUBMIT_REQUEST_SUCCESS,
        failureEvent: SubmissionEvent.SUBMIT_REQUEST_FAIL,
        trackingCtx: this.ctx.trackingCtx,
      }
    );
  }

  protected abstract createPlatformSubmissionAsync(
    input: SubmissionInput<P>
  ): Promise<SubmissionFragment>;
}
