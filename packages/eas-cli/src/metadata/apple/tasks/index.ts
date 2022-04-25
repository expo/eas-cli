import { AppleTask } from '../task';
import { AgeRatingTask } from './age-rating';
import { AppInfoTask } from './app-info';
import { AppVersionTask } from './app-version';

type AppleTaskOptions = {
  projectDir: string;
};

/** @todo Add screenshot tasks, requires a new version of @expo/apple-utils */
export function createAppleTasks(_options: AppleTaskOptions): AppleTask[] {
  return [new AppVersionTask(), new AppInfoTask(), new AgeRatingTask()];
}
