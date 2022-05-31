import { logEvent } from './rudderstackClient';
export type Event = BuildEvent | SubmissionEvent | MetadataEvent;

export enum SubmissionEvent {
  SUBMIT_COMMAND = 'submit cli submit command',
  SUBMIT_COMMAND_ATTEMPT = 'submit cli attempt',
  SUBMIT_COMMAND_SUCCESS = 'submit cli success',
  SUBMIT_COMMAND_FAIL = 'submit cli fail',
  GATHER_CREDENTIALS_ATTEMPT = 'submit cli gather credentials attempt',
  GATHER_CREDENTIALS_SUCCESS = 'submit cli gather credentials success',
  GATHER_CREDENTIALS_FAIL = 'submit cli gather credentials fail',
  GATHER_ARCHIVE_ATTEMPT = 'submit cli gather archive attempt',
  GATHER_ARCHIVE_SUCCESS = 'submit cli gather archive success',
  GATHER_ARCHIVE_FAIL = 'submit cli gather archive fail',
  SUBMIT_REQUEST_ATTEMPT = 'submit cli request attempt',
  SUBMIT_REQUEST_SUCCESS = 'submit cli request success',
  SUBMIT_REQUEST_FAIL = 'submit cli request fail',
}

export enum BuildEvent {
  BUILD_COMMAND = 'build cli build command',
  PROJECT_UPLOAD_ATTEMPT = 'build cli project upload attempt',
  PROJECT_UPLOAD_SUCCESS = 'build cli project upload success',
  PROJECT_UPLOAD_FAIL = 'build cli project upload fail',
  GATHER_CREDENTIALS_ATTEMPT = 'build cli gather credentials attempt',
  GATHER_CREDENTIALS_SUCCESS = 'build cli gather credentials success',
  GATHER_CREDENTIALS_FAIL = 'build cli gather credentials fail',
  CONFIGURE_PROJECT_ATTEMPT = 'build cli configure project attempt',
  CONFIGURE_PROJECT_SUCCESS = 'build cli configure project success',
  CONFIGURE_PROJECT_FAIL = 'build cli configure project fail',
  BUILD_REQUEST_ATTEMPT = 'build cli build request attempt',
  BUILD_REQUEST_SUCCESS = 'build cli build request success',
  BUILD_REQUEST_FAIL = 'build cli build request fail',

  BUILD_STATUS_COMMAND = 'build cli build status',

  CREDENTIALS_SYNC_COMMAND = 'build cli credentials sync command',
  CREDENTIALS_SYNC_UPDATE_LOCAL_ATTEMPT = 'build cli credentials sync update local attempt',
  CREDENTIALS_SYNC_UPDATE_LOCAL_SUCCESS = 'build cli credentials sync update local success',
  CREDENTIALS_SYNC_UPDATE_LOCAL_FAIL = 'build cli credentials sync update local fail',
  CREDENTIALS_SYNC_UPDATE_REMOTE_ATTEMPT = 'build cli credentials sync update remote attempt',
  CREDENTIALS_SYNC_UPDATE_REMOTE_SUCCESS = 'build cli credentials sync update remote success',
  CREDENTIALS_SYNC_UPDATE_REMOTE_FAIL = 'build cli credentials sync update remote fail',

  ANDROID_KEYSTORE_CREATE = 'build cli credentials keystore create',
}

export enum MetadataEvent {
  APPLE_METADATA_DOWNLOAD = 'metadata cli download apple response',
  APPLE_METADATA_UPLOAD = 'metadata cli upload apple response',
}

export class Analytics {
  static logEvent(name: Event, properties: Record<string, any>): void {
    logEvent(name, properties);
  }
}
