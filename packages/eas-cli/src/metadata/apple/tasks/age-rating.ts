import { AgeRatingDeclaration } from '@expo/apple-utils';
import chalk from 'chalk';

import Log from '../../../log';
import { logAsync } from '../../utils/log';
import { AppleTask, TaskDownloadOptions, TaskPrepareOptions, TaskUploadOptions } from '../task';

export type AgeRatingData = {
  /** The app age rating declaration for the app info */
  ageRating: AgeRatingDeclaration;
};

export class AgeRatingTask extends AppleTask {
  public name = (): string => 'age rating declarations';

  public async prepareAsync({ context }: TaskPrepareOptions): Promise<void> {
    if (!context.info) {
      return;
    }
    // The ageRatingDeclaration relationship is on appInfos (not appStoreVersions).
    try {
      context.ageRating = (await context.info.getAgeRatingDeclarationAsync()) ?? undefined;
    } catch (error: any) {
      // Gracefully handle cases where the relationship is not available
      if (error?.message?.includes('ageRatingDeclaration')) {
        Log.warn(
          chalk`{yellow Skipped age rating - not available for this app. This may require updating through App Store Connect directly.}`
        );
        return;
      }
      throw error;
    }
  }

  public async downloadAsync({ config, context }: TaskDownloadOptions): Promise<void> {
    if (context.ageRating) {
      config.setAgeRating(context.ageRating.attributes);
    }
  }

  public async uploadAsync({ config, context }: TaskUploadOptions): Promise<void> {
    if (!context.ageRating) {
      Log.log(chalk`{dim - Skipped age rating update, not available}`);
      return;
    }

    const ageRating = config.getAgeRating();
    if (!ageRating) {
      Log.log(chalk`{dim - Skipped age rating update, no advisory configured}`);
    } else {
      context.ageRating = await logAsync(() => context.ageRating.updateAsync(ageRating), {
        pending: 'Updating age rating declaration...',
        success: 'Updated age rating declaration',
        failure: 'Failed to update age rating declaration',
      });
    }
  }
}
