import RudderAnalytics from '@expo/rudder-sdk-node';
import os from 'os';
import { URL } from 'url';
import { v4 as uuidv4 } from 'uuid';

import { Actor, getActorDisplayName } from '../user/User';
import UserSettings from '../user/UserSettings';
import { easCliVersion } from '../utils/easCli';

const PLATFORM_TO_ANALYTICS_PLATFORM: Partial<Record<NodeJS.Platform, string>> = {
  darwin: 'Mac',
  win32: 'Windows',
  linux: 'Linux',
};

export type AnalyticsEvent = CommandEvent | BuildEvent | SubmissionEvent | MetadataEvent;

export enum CommandEvent {
  ACTION = 'action', // generic event type which is used to determine the 'daily active user' stat, include an `action: eas ${subcommand}` property inside of the event properties object
}

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
  API_KEY_DOWNLOAD_FAIL = 'submit cli credentials api key download fail',
  API_KEY_DOWNLOAD_RETRY = 'submit cli credentials api key download fail temporary',
  API_KEY_DOWNLOAD_SUCCESS = 'submit cli credentials api key download succeed',
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

export type AnalyticsEventProperties = Record<string, string | number | boolean>;

/**
 * The interface for commands to use to log events to analytics.
 */
export interface Analytics {
  logEvent(name: AnalyticsEvent, properties: AnalyticsEventProperties): void;
}

/**
 * The interface for commands to use to orchestrate the analytics system. Should only be necessary to use
 * this within EASCommand.
 */
export interface AnalyticsWithOrchestration extends Analytics {
  setActor(actor: Actor): void;
  flushAsync(): Promise<void>;
}

const USER_SETTINGS_KEY_AMPLITUDE_ENABLED = 'amplitudeEnabled';
const USER_SETTINGS_KEY_AMPLITUDE_DEVICE_ID = 'amplitudeDeviceId';
const USER_SETTINGS_KEY_ANALYTICS_ENABLED = 'analyticsEnabled';
const USER_SETTINGS_KEY_ANALYTICS_DEVICE_ID = 'analyticsDeviceId';

/**
 * Sets the user's analytics enabled preference. Note that this will only take effect
 * upon the next run of the CLI.
 */
export async function setAnalyticsEnabledAsync(enabled: boolean): Promise<void> {
  await UserSettings.setAsync(USER_SETTINGS_KEY_ANALYTICS_ENABLED, enabled);
}

/**
 * Returns the user's analytics enabled preference.
 */
export async function getAnalyticsEnabledAsync(): Promise<boolean> {
  const analyticsEnabled = await UserSettings.getAsync(USER_SETTINGS_KEY_ANALYTICS_ENABLED, null);
  return !!analyticsEnabled;
}

/**
 * Create an instance of Analytics based on the user's analytics enabled preferences.
 */
export async function createAnalyticsAsync(): Promise<AnalyticsWithOrchestration> {
  // TODO: remove after some time
  const amplitudeEnabled = await UserSettings.getAsync(USER_SETTINGS_KEY_AMPLITUDE_ENABLED, null);
  if (amplitudeEnabled !== null) {
    await UserSettings.setAsync(USER_SETTINGS_KEY_ANALYTICS_ENABLED, amplitudeEnabled);
    await UserSettings.deleteKeyAsync(USER_SETTINGS_KEY_AMPLITUDE_ENABLED);
  }
  const amplitudeDeviceId = await UserSettings.getAsync(
    USER_SETTINGS_KEY_AMPLITUDE_DEVICE_ID,
    null
  );
  if (amplitudeDeviceId !== null) {
    await UserSettings.setAsync(USER_SETTINGS_KEY_ANALYTICS_DEVICE_ID, amplitudeDeviceId);
    await UserSettings.deleteKeyAsync(USER_SETTINGS_KEY_AMPLITUDE_DEVICE_ID);
  }

  if (process.env.DISABLE_EAS_ANALYTICS) {
    await UserSettings.setAsync(USER_SETTINGS_KEY_ANALYTICS_ENABLED, false);
  }

  const analyticsEnabled =
    !process.env.https_proxy && // disable analytics if running behind proxy
    (await UserSettings.getAsync(USER_SETTINGS_KEY_ANALYTICS_ENABLED, true));
  if (!analyticsEnabled) {
    return new NoOpAnalytics();
  }

  const persistedDeviceId = await UserSettings.getAsync(
    USER_SETTINGS_KEY_ANALYTICS_DEVICE_ID,
    null
  );
  const deviceId = persistedDeviceId ?? uuidv4();
  if (!persistedDeviceId) {
    await UserSettings.setAsync(USER_SETTINGS_KEY_ANALYTICS_DEVICE_ID, deviceId);
  }
  return new RudderstackAnalytics(deviceId);
}

class NoOpAnalytics implements AnalyticsWithOrchestration {
  logEvent(): void {}
  setActor(): void {}
  async flushAsync(): Promise<void> {}
}

const RudderstackAnalyticsConfig =
  process.env.EXPO_STAGING || process.env.EXPO_LOCAL
    ? {
        // staging environment
        rudderstackWriteKey: '1wpX20Da4ltFGSXbPFYUL00Chb7',
        rudderstackDataPlaneURL: 'https://cdp.expo.dev',
      }
    : {
        // prod environment
        rudderstackWriteKey: '1wpXLFxmujq86etH6G6cc90hPcC',
        rudderstackDataPlaneURL: 'https://cdp.expo.dev',
      };

class RudderstackAnalytics implements AnalyticsWithOrchestration {
  private readonly rudderstackClient = new RudderAnalytics(
    RudderstackAnalyticsConfig.rudderstackWriteKey,
    new URL('/v1/batch', RudderstackAnalyticsConfig.rudderstackDataPlaneURL).toString(),
    {
      flushInterval: 300,
    }
  );

  private identifiedActor: Actor | null = null;

  constructor(private readonly persistentDeviceId: string) {
    // identify once with just anonymous ID. Once the actor is fetched, re-indentify with
    // both so that they can be associated
    this.rudderstackClient.identify({
      anonymousId: persistentDeviceId,
    });
  }

  public setActor(actor: Actor): void {
    if (this.identifiedActor) {
      return;
    }

    this.rudderstackClient.identify({
      userId: actor.id,
      anonymousId: this.persistentDeviceId,
      traits: {
        username: getActorDisplayName(actor),
        user_id: actor.id,
        user_type: actor.__typename,
      },
    });
    this.identifiedActor = actor;
  }

  public logEvent(name: AnalyticsEvent, properties: AnalyticsEventProperties): void {
    const userId = this.identifiedActor?.id;
    const deviceId = this.persistentDeviceId;
    const commonEventProperties = { source_version: easCliVersion, source: 'eas cli' };
    const identity = { userId: userId ?? undefined, anonymousId: deviceId ?? uuidv4() };
    this.rudderstackClient.track({
      event: name,
      properties: { ...properties, ...commonEventProperties },
      ...identity,
      context: this.getRudderStackContext(),
    });
  }

  public async flushAsync(): Promise<void> {
    await this.rudderstackClient.flush();
  }

  private getRudderStackContext(): Record<string, any> {
    const platform = PLATFORM_TO_ANALYTICS_PLATFORM[os.platform()] || os.platform();
    return {
      os: { name: platform, version: os.release() },
      device: { type: platform, model: platform },
      app: { name: 'eas cli', version: easCliVersion ?? undefined },
    };
  }
}
