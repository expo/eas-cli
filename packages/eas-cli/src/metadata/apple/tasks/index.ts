import { AgeRatingTask } from './age-rating';
import { AppClipTask } from './app-clip';
import { AppInfoTask } from './app-info';
import { AppReviewDetailTask } from './app-review-detail';
import { AppVersionOptions, AppVersionTask } from './app-version';
import { PreviewsTask } from './previews';
import { ScreenshotsTask } from './screenshots';
import { AppleTask } from '../task';

type AppleTaskOptions = {
  version?: AppVersionOptions['version'];
  /** If enabled, screenshots are not downloaded or uploaded */
  skipScreenshots?: boolean;
  /** If enabled, video previews are not downloaded or uploaded */
  skipPreviews?: boolean;
};

/**
 * List of all eligible tasks to sync local store configuration to the App store.
 */
export function createAppleTasks({
  version,
  skipScreenshots,
  skipPreviews,
}: AppleTaskOptions = {}): AppleTask[] {
  const tasks = [
    new AppVersionTask({ version }),
    new AppInfoTask(),
    new AgeRatingTask(),
    new AppReviewDetailTask(),
    new ScreenshotsTask(),
    new PreviewsTask(),
    new AppClipTask(),
  ];

  return tasks.filter(task => {
    if (skipScreenshots && task instanceof ScreenshotsTask) {
      return false;
    }
    if (skipPreviews && task instanceof PreviewsTask) {
      return false;
    }
    return true;
  });
}
