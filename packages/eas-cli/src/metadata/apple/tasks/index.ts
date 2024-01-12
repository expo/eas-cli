import { AgeRatingTask } from './age-rating';
import { AppInfoTask } from './app-info';
import { AppReviewDetailTask } from './app-review-detail';
import { AppVersionOptions, AppVersionTask } from './app-version';
import { AppleTask } from '../task';

type AppleTaskOptions = {
  version?: AppVersionOptions['version'];
};

/**
 * List of all eligible tasks to sync local store configuration to the App store.
 */
export function createAppleTasks({ version }: AppleTaskOptions = {}): AppleTask[] {
  return [
    new AppVersionTask({ version }),
    new AppInfoTask(),
    new AgeRatingTask(),
    new AppReviewDetailTask(),
  ];
}
