import { MetadataContext } from '../../context';
import { AppleTask } from '../task';
import { AgeRatingTask } from './age-rating';
import { AppInfoTask } from './app-info';
import { AppVersionTask } from './app-version';

/**
 * List of all eligible tasks to sync local store configuration to the App store.
 */
export function createAppleTasks(_ctx: MetadataContext): AppleTask[] {
  return [new AppVersionTask(), new AppInfoTask(), new AgeRatingTask()];
}
