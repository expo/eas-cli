import { AppStoreReviewDetail } from '@expo/apple-utils';
import assert from 'assert';
import chalk from 'chalk';

import Log from '../../../log';
import { logAsync } from '../../utils/log';
import { AppleTask, TaskDownloadOptions, TaskPrepareOptions, TaskUploadOptions } from '../task';

export type AppReviewData = {
  /** The current app info that should be edited */
  reviewDetail: AppStoreReviewDetail;
};

/** Handle all contact, demo account, or instruction info that are required for the App Store review team. */
export class AppReviewDetailTask extends AppleTask {
  public name = (): string => 'app review detail';

  public async prepareAsync({ context }: TaskPrepareOptions): Promise<void> {
    assert(context.version, `App version not initialized, can't download store review details`);
    context.reviewDetail = (await context.version.getAppStoreReviewDetailAsync()) ?? undefined;
  }

  public async downloadAsync({ config, context }: TaskDownloadOptions): Promise<void> {
    if (context.reviewDetail) {
      config.setReviewDetails(context.reviewDetail.attributes);
    }
  }

  public async uploadAsync({ config, context }: TaskUploadOptions): Promise<void> {
    const reviewDetail = config.getReviewDetails();
    if (!reviewDetail) {
      Log.log(chalk`{dim - Skipped store review details, not configured}`);
      return;
    }

    assert(context.version, `App version not initialized, can't upload store review details`);
    const { versionString } = context.version.attributes;

    if (!context.reviewDetail) {
      // We can't set the demo required property when creating, omit it from the request
      const { demoAccountRequired, ...reviewDetailsToCreate } = reviewDetail;

      context.reviewDetail = await logAsync(
        () => context.version.createReviewDetailAsync(reviewDetailsToCreate),
        {
          pending: `Creating store review details for ${chalk.bold(versionString)}...`,
          success: `Created store review details for ${chalk.bold(versionString)}`,
          failure: `Failed creating store review details for ${chalk.bold(versionString)}`,
        }
      );
    }

    context.reviewDetail = await logAsync(() => context.reviewDetail.updateAsync(reviewDetail), {
      pending: `Updating store review details for ${chalk.bold(versionString)}...`,
      success: `Updated store review details for ${chalk.bold(versionString)}`,
      failure: `Failed updating store review details for ${chalk.bold(versionString)}`,
    });
  }
}
