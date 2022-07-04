import { MetadataContext } from '../../context.js';
import { AppleTask } from '../task.js';
import { AgeRatingTask } from './age-rating.js';
import { AppInfoTask } from './app-info.js';
import { AppReviewDetailTask } from './app-review-detail.js';
import { AppVersionTask } from './app-version.js';

/**
 * List of all eligible tasks to sync local store configuration to the App store.
 */
export function createAppleTasks(_ctx: MetadataContext): AppleTask[] {
  return [new AppVersionTask(), new AppInfoTask(), new AgeRatingTask(), new AppReviewDetailTask()];
}
