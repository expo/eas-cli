import { logEvent } from '../analytics';

export type TrackingContext = Record<string, string | number | boolean>;

export enum SubmissionEvent {
  SUBMIT_COMMAND = 'submit cli submit command',
  SUBMIT_COMMAND_SUCCESS = 'submit cli success',
  SUBMIT_COMMAND_FAIL = 'submit cli fail',
  GATHER_CREDENTIALS_SUCCESS = 'submit cli gather credentials success',
  GATHER_CREDENTIALS_FAIL = 'submit cli gather credentials fail',
  GATHER_ARCHIVE_SUCCESS = 'submit cli gather archive success',
  GATHER_ARCHIVE_FAIL = 'submit cli gather archive fail',
  MUTATION_SUCCESS = 'submit cli server mutation success',
  MUTATION_FAIL = 'submit cli server mutation fail',
}

export enum BuildEvent {
  BUILD_COMMAND = 'build cli build command',
  PROJECT_UPLOAD_SUCCESS = 'build cli project upload success',
  PROJECT_UPLOAD_FAIL = 'build cli project upload fail',
  GATHER_CREDENTIALS_SUCCESS = 'build cli gather credentials success',
  GATHER_CREDENTIALS_FAIL = 'build cli gather credentials fail',
  CONFIGURE_PROJECT_SUCCESS = 'build cli configure project success',
  CONFIGURE_PROJECT_FAIL = 'build cli configure project fail',
  BUILD_REQUEST_SUCCESS = 'build cli build request success',
  BUILD_REQUEST_FAIL = 'build cli build request fail',

  BUILD_STATUS_COMMAND = 'build cli build status',

  CREDENTIALS_SYNC_COMMAND = 'build cli credentials sync command',
  CREDENTIALS_SYNC_UPDATE_LOCAL_SUCCESS = 'build cli credentials sync update local success',
  CREDENTIALS_SYNC_UPDATE_LOCAL_FAIL = 'build cli credentials sync update local fail',
  CREDENTIALS_SYNC_UPDATE_REMOTE_SUCCESS = 'build cli credentials sync update remote success',
  CREDENTIALS_SYNC_UPDATE_REMOTE_FAIL = 'build cli credentials sync update remote fail',

  ANDROID_KEYSTORE_CREATE = 'build cli credentials keystore create',
}

export type Event = BuildEvent | SubmissionEvent;
export async function withAnalyticsAsync<Result>(
  fn: () => Promise<Result>,
  analytics: {
    successEvent: Event;
    failureEvent: Event;
    trackingCtx: TrackingContext;
  }
): Promise<Result> {
  try {
    const result = await fn();
    Analytics.logEvent(analytics.successEvent, analytics.trackingCtx);
    return result;
  } catch (error: any) {
    Analytics.logEvent(analytics.failureEvent, {
      ...analytics.trackingCtx,
      reason: error.message,
    });
    throw error;
  }
}

export class Analytics {
  static logEvent(name: Event, properties: Record<string, any>): void {
    logEvent(name, properties);
  }
}
