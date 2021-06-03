import { logEvent } from '../../analytics';

export enum Event {
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
}

export default {
  logEvent(name: Event, properties: Record<string, any>) {
    logEvent(name, properties);
  },
};
