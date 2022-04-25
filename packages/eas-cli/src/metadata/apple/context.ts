import type { App } from '@expo/apple-utils';

import type { AgeRatingContext } from './tasks/age-rating';
import type { AppInfoContext } from './tasks/app-info';
import type { AppVersionContext } from './tasks/app-version';

/**
 * The fully prepared apple context, used within the `upload` tasks.
 * It contains references to each individual models, to update based on the user's config.
 */
export type AppleContext = { app: App } & AppInfoContext & AppVersionContext & AgeRatingContext;

/**
 * The unprepared partial apple context, used within the `preupload` tasks.
 * It contains a reference to the app, each task should populate the context with the necessary data.
 */
export type PartialAppleContext = { app: App } & Partial<Omit<AppleContext, 'app'>>;
