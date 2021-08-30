import { Identify } from '@amplitude/identify';
import * as Amplitude from '@amplitude/node';
import RudderAnalytics from '@expo/rudder-sdk-node';
import os from 'os';
import { URL } from 'url';
import { v4 as uuidv4 } from 'uuid';

import UserSettings from './user/UserSettings';

/**
 * We use require() to exclude package.json from TypeScript's analysis since it lives outside
 * the src directory and would change the directory structure of the emitted files
 * under the build directory
 */
const packageJSON = require('../package.json');

const PLATFORM_TO_ANALYTICS_PLATFORM: { [platform: string]: string } = {
  darwin: 'Mac',
  win32: 'Windows',
  linux: 'Linux',
};

let amplitudeClient: Amplitude.NodeClient | null = null;
let rudderstackClient: RudderAnalytics | null = null;
let userIdentified = false;
let identifyData: {
  userId: string;
  deviceId: string;
  identify: Identify;
} | null = null;

export async function initAsync(): Promise<void> {
  if (process.env.DISABLE_EAS_ANALYTICS) {
    await UserSettings.setAsync('amplitudeEnabled', false);
  }
  const amplitudeEnabled = await UserSettings.getAsync('amplitudeEnabled', true);
  if (amplitudeEnabled) {
    const config =
      process.env.EXPO_STAGING || process.env.EXPO_LOCAL
        ? {
            // staging environment
            amplitudeWriteKey: 'cdebbc678931403439486c4750781544',
            rudderstackWriteKey: '1wpX20Da4ltFGSXbPFYUL00Chb7',
            rudderstackDataPlaneURL: 'https://cdp.expo.dev',
          }
        : {
            // prod environment
            amplitudeWriteKey: '4ac443afd5073c0df6169291db1d3495',
            rudderstackWriteKey: '1wpXLFxmujq86etH6G6cc90hPcC',
            rudderstackDataPlaneURL: 'https://cdp.expo.dev',
          };

    amplitudeClient = Amplitude.init(config.amplitudeWriteKey, {
      retryClass: new Amplitude.OfflineRetryHandler(config.amplitudeWriteKey),
    });

    rudderstackClient = new RudderAnalytics(
      config.rudderstackWriteKey,
      new URL('/v1/batch', config.rudderstackDataPlaneURL).toString(),
      {
        flushInterval: 300,
      }
    );
    rudderstackClient.logger.silent = true;
  }
}

export async function setUserDataAsync(
  userId: string,
  properties: Record<string, any>
): Promise<void> {
  const identify = new Identify();
  Object.entries(properties).forEach(([property, value]) => {
    identify.set(property, value);
  });
  const savedDeviceId = await UserSettings.getAsync('amplitudeDeviceId', null);
  const deviceId = savedDeviceId ?? uuidv4();
  if (!savedDeviceId) {
    await UserSettings.setAsync('amplitudeDeviceId', deviceId);
  }

  identifyData = {
    userId,
    deviceId,
    identify,
  };

  ensureUserIdentified();
}

export async function flushAsync(): Promise<void> {
  if (rudderstackClient) {
    rudderstackClient.flush();
  }

  if (amplitudeClient) {
    await amplitudeClient.flush();
  }
}

export function logEvent(name: string, properties: Record<string, any> = {}) {
  if (!amplitudeClient && !rudderstackClient) {
    return;
  }
  ensureUserIdentified();

  const { userId, deviceId } = identifyData ?? {};
  const commonEventProperties = { source_version: packageJSON?.version, source: 'eas cli' };

  if (amplitudeClient) {
    amplitudeClient.logEvent({
      event_type: name,
      event_properties: { ...properties, ...commonEventProperties },
      ...(userId && { user_id: userId }),
      ...(deviceId && { device_id: deviceId }),
      ...getAmplitudeContext(),
    });
  }

  if (rudderstackClient) {
    const identity = { userId: userId ?? undefined, anonymousId: deviceId ?? uuidv4() };
    rudderstackClient.track({
      event: name,
      properties: { ...properties, ...commonEventProperties },
      ...identity,
      context: getRudderStackContext(),
    });
  }
}

function ensureUserIdentified() {
  if (!(rudderstackClient || amplitudeClient) || userIdentified || !identifyData) {
    return;
  }

  if (amplitudeClient) {
    amplitudeClient.identify(identifyData.userId, identifyData.deviceId, identifyData.identify);
  }

  if (rudderstackClient) {
    rudderstackClient.identify({
      userId: identifyData.userId,
      anonymousId: identifyData.deviceId,
    });
  }
  userIdentified = true;
}

function getAmplitudeContext() {
  const platform = PLATFORM_TO_ANALYTICS_PLATFORM[os.platform()] || os.platform();
  return {
    os_name: platform,
    os_version: os.release(),
    device_brand: platform,
    device_model: platform,
  };
}

function getRudderStackContext() {
  const platform = PLATFORM_TO_ANALYTICS_PLATFORM[os.platform()] || os.platform();
  return {
    os: { name: platform, version: os.release() },
    device: { type: platform, model: platform },
    app: { name: 'eas cli', version: packageJSON?.version ?? undefined },
  };
}

export enum AnalyticsEvent {
  ACTION = 'action', // generic event type which is used to determine the 'daily active user' stat, include an `action: eas ${subcommand}` property inside of the event properties object
}
