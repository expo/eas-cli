import type { App } from '@expo/apple-utils';

import type { AgeRatingData } from './tasks/age-rating';
import type { AppInfoData } from './tasks/app-info';
import type { AppReviewData } from './tasks/app-review-detail';
import type { AppVersionData } from './tasks/app-version';
import type { PreviewsData } from './tasks/previews';
import type { ScreenshotsData } from './tasks/screenshots';

/**
 * The fully prepared apple data, used within the `downloadAsync` or `uploadAsync` tasks.
 * It contains references to each individual models, to either upload or download App Store data.
 */
export type AppleData = { app: App; projectDir: string } & AppInfoData &
  AppVersionData &
  AgeRatingData &
  AppReviewData &
  ScreenshotsData &
  PreviewsData;

/**
 * The unprepared partial apple data, used within the `prepareAsync` tasks.
 * It contains a reference to the app, each task should populate the necessary data.
 * If an entity fails to prepare the data, individual tasks should raise errors about the missing data.
 */
export type PartialAppleData = { app: App; projectDir: string } & Partial<Omit<AppleData, 'app' | 'projectDir'>>;
