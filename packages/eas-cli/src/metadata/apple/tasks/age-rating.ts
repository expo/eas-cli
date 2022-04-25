import { AgeRatingDeclaration } from '@expo/apple-utils';
import assert from 'assert';
import chalk from 'chalk';

import Log from '../../../log';
import { logAsync } from '../../utils/log';
import { AppleTask, TaskPrepareOptions, TaskUploadOptions } from '../task';

export type AgeRatingContext = {
  /** The app age rating declaration for the app version */
  ageRating: AgeRatingDeclaration;
};

export class AgeRatingTask extends AppleTask {
  name = (): string => 'age rating declarations';

  async preuploadAsync({ context }: TaskPrepareOptions): Promise<void> {
    assert(context.version, `App version information is not prepared, can't update age rating`);
    context.ageRating = (await context.version.getAgeRatingDeclarationAsync()) || undefined;
  }

  async uploadAsync({ config, context }: TaskUploadOptions): Promise<void> {
    assert(context.ageRating, `Age rating not initialized, can't update age rating`);

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
