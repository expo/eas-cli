import { AppStoreReviewAttachment, AppStoreReviewDetail } from '@expo/apple-utils';
import chalk from 'chalk';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import Log from '../../../log';
import { logAsync } from '../../utils/log';
import { AppleTask, TaskDownloadOptions, TaskPrepareOptions, TaskUploadOptions } from '../task';

export type AppReviewData = {
  /** The current app info that should be edited */
  reviewDetail: AppStoreReviewDetail;
};

/** Default directory (relative to project root) for downloaded review attachments. */
const REVIEW_ATTACHMENT_DIR = path.join('store', 'apple', 'review-attachment');

function md5OfFile(absolutePath: string): string {
  const bytes = fs.readFileSync(absolutePath);
  return crypto.createHash('md5').update(bytes).digest('hex');
}

/** Handle all contact, demo account, or instruction info that are required for the App Store review team. */
export class AppReviewDetailTask extends AppleTask {
  public name = (): string => 'app review detail';

  public async prepareAsync({ context }: TaskPrepareOptions): Promise<void> {
    if (!context.version) {
      return;
    }
    context.reviewDetail = (await context.version.getAppStoreReviewDetailAsync()) ?? undefined;
  }

  public async downloadAsync({ config, context }: TaskDownloadOptions): Promise<void> {
    if (!context.reviewDetail) {
      return;
    }

    config.setReviewDetails(context.reviewDetail.attributes);

    // Persist the review attachment entry, if one exists. The App Store Connect
    // API does not currently expose a download URL for review attachments, so
    // we cannot fetch the original bytes back. Instead we record a placeholder
    // path so that the user knows an attachment exists and can either drop in
    // a replacement file or remove the entry to delete the remote attachment.
    const attachments = context.reviewDetail.attributes.appStoreReviewAttachments ?? [];
    const attachment = attachments[0];
    if (!attachment) {
      return;
    }

    const fileName = attachment.attributes.fileName || 'attachment';
    const relativePath = path.join(REVIEW_ATTACHMENT_DIR, fileName);
    const absolutePath = path.resolve(context.projectDir, relativePath);

    if (!fs.existsSync(absolutePath)) {
      try {
        await fs.promises.mkdir(path.dirname(absolutePath), { recursive: true });
      } catch {
        // Ignore directory creation failures - we still want to record the path.
      }
      Log.warn(
        chalk`{yellow Review attachment ${chalk.bold(
          fileName
        )} exists in App Store Connect but cannot be downloaded; place the file at ${chalk.bold(
          relativePath
        )} to keep it in sync.}`
      );
    }

    config.setReviewAttachment(relativePath);
  }

  public async uploadAsync({ config, context }: TaskUploadOptions): Promise<void> {
    const reviewDetail = config.getReviewDetails();
    if (!reviewDetail) {
      Log.log(chalk`{dim - Skipped store review details, not configured}`);
      return;
    }

    if (!context.version) {
      Log.log(chalk`{dim - Skipped store review details, no version available}`);
      return;
    }
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

    // Capture existing attachments before the patch response overwrites them. The
    // PATCH response doesn't include the related `appStoreReviewAttachments`, so
    // we need to reuse the version we fetched in `prepareAsync` to make a
    // checksum-based skip decision below.
    const existingAttachments = context.reviewDetail.attributes.appStoreReviewAttachments ?? [];

    context.reviewDetail = await logAsync(() => context.reviewDetail.updateAsync(reviewDetail), {
      pending: `Updating store review details for ${chalk.bold(versionString)}...`,
      success: `Updated store review details for ${chalk.bold(versionString)}`,
      failure: `Failed updating store review details for ${chalk.bold(versionString)}`,
    });

    await this.syncAttachmentAsync({
      attachmentPath: config.getReviewAttachment(),
      reviewDetail: context.reviewDetail,
      existingAttachments,
      projectDir: context.projectDir,
    });
  }

  /**
   * Sync the App Store review attachment.
   * - When no attachment is configured, do nothing (existing remote attachments are left alone).
   * - When the configured file matches an existing attachment by checksum, skip re-upload.
   * - Otherwise delete any existing attachment(s) and upload the new file.
   */
  private async syncAttachmentAsync({
    attachmentPath,
    reviewDetail,
    existingAttachments,
    projectDir,
  }: {
    attachmentPath: string | null;
    reviewDetail: AppStoreReviewDetail;
    existingAttachments: AppStoreReviewAttachment[];
    projectDir: string;
  }): Promise<void> {
    if (!attachmentPath) {
      return;
    }

    const absolutePath = path.resolve(projectDir, attachmentPath);
    if (!fs.existsSync(absolutePath)) {
      Log.warn(chalk`{yellow Review attachment not found: ${absolutePath}}`);
      return;
    }

    const fileName = path.basename(absolutePath);
    const localChecksum = md5OfFile(absolutePath);

    const matching = existingAttachments.find(
      attachment =>
        attachment.attributes.uploaded &&
        attachment.attributes.sourceFileChecksum === localChecksum
    );

    if (matching) {
      Log.log(chalk`{dim - Skipped review attachment ${fileName}, already up to date}`);
      return;
    }

    // Remove any stale attachments before uploading the new one. App Store
    // Connect generally allows a single review attachment per review detail,
    // so we replace whatever is currently there.
    for (const attachment of existingAttachments) {
      await logAsync(() => attachment.deleteAsync(), {
        pending: `Deleting review attachment ${chalk.bold(attachment.attributes.fileName)}...`,
        success: `Deleted review attachment ${chalk.bold(attachment.attributes.fileName)}`,
        failure: `Failed deleting review attachment ${chalk.bold(attachment.attributes.fileName)}`,
      });
    }

    await logAsync(() => reviewDetail.uploadAttachmentAsync(absolutePath), {
      pending: `Uploading review attachment ${chalk.bold(fileName)}...`,
      success: `Uploaded review attachment ${chalk.bold(fileName)}`,
      failure: `Failed uploading review attachment ${chalk.bold(fileName)}`,
    });
  }
}
