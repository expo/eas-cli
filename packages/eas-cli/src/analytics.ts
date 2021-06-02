import { Identify } from '@amplitude/identify';
import * as Amplitude from '@amplitude/node';
import os from 'os';
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

let client: Amplitude.NodeClient | null = null;
let userIdentifyCalled = false;
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
    const apiKey =
      process.env.EXPO_STAGING || process.env.EXPO_LOCAL
        ? 'cdebbc678931403439486c4750781544'
        : '4ac443afd5073c0df6169291db1d3495';
    client = Amplitude.init(apiKey);
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
  if (client) {
    await client.flush();
  }
}

export function logEvent(name: string, properties: Record<string, any> = {}) {
  if (client) {
    ensureUserIdentified();
    const { userId, deviceId } = identifyData ?? {};
    client.logEvent({
      event_type: name,
      event_properties: properties,
      ...(userId && { user_id: userId }),
      ...(deviceId && { device_id: deviceId }),
      ...getContext(),
    });
  }
}

function ensureUserIdentified() {
  if (client && !userIdentifyCalled && identifyData) {
    client.identify(identifyData.userId, identifyData.deviceId, identifyData.identify);
    userIdentifyCalled = true;
  }
}

function getContext() {
  const platform = PLATFORM_TO_ANALYTICS_PLATFORM[os.platform()] || os.platform();
  return {
    os_name: platform,
    os_version: os.release(),
    device_brand: platform,
    device_model: platform,
    source_version: packageJSON?.version,
    source: 'eas cli',
  };
}
