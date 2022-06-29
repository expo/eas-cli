import type { App } from '@expo/apple-utils';

import type { AgeRatingData } from './tasks/age-rating';
import type { AppInfoData } from './tasks/app-info';
import type { AppReviewData } from './tasks/app-review-detail';
import type { AppVersionData } from './tasks/app-version';

/**
 * The fully prepared apple data, used within the `downloadAsync` or `uploadAsync` tasks.
 * It contains references to each individual models, to either upload or download App Store data.
 */
export type AppleData = { app: App } & AppInfoData & AppVersionData & AgeRatingData & AppReviewData;

/**
 * The unprepared partial apple data, used within the `prepareAsync` tasks.
 * It contains a reference to the app, each task should populate the necessary data.
 * If an entity fails to prepare the data, individual tasks should raise errors about the missing data.
 */
export type PartialAppleData = { app: App } & Partial<Omit<AppleData, 'app'>>;
