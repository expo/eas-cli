import {
  BundleId,
  BundleIdCapability,
  CapabilityOptionMap,
  CapabilityType,
  CapabilityTypeDataProtectionOption,
  CapabilityTypeOption,
} from '@expo/apple-utils';
import { JSONObject, JSONValue } from '@expo/json-file';
import getenv from 'getenv';

import Log from '../../../log';

const EXPO_NO_CAPABILITY_SYNC = getenv.boolish('EXPO_NO_CAPABILITY_SYNC', false);

type GetOptionsMethod<T extends CapabilityType = any> = (
  entitlement: JSONValue,
  entitlementsJson: JSONObject
) => CapabilityOptionMap[T];

const validateBooleanOptions = (options: any): boolean => {
  return typeof options === 'boolean';
};

const validateStringArrayOptions = (options: any): boolean => {
  return Array.isArray(options) && options.every(option => typeof option === 'string');
};

const createValidateStringOptions = (allowed: string[]) => (options: any): boolean => {
  return allowed.includes(options);
};

const createValidateStringArrayOptions = (allowed: string[]) => (options: any): boolean => {
  return Array.isArray(options) && options.every(option => allowed.includes(option));
};

const validateDevProdString = createValidateStringOptions(['development', 'production']);

const getBooleanOptions: GetOptionsMethod = entitlement => {
  return entitlement === true ? CapabilityTypeOption.ON : CapabilityTypeOption.OFF;
};

const getDefinedOptions: GetOptionsMethod = entitlement => {
  return entitlement ? CapabilityTypeOption.ON : CapabilityTypeOption.OFF;
};

/**
 * Given an entitlements JSON object, synchronizes the remote capabilities for a bundle identifier.
 *
 * Example entitlements JSON:
 * ```js
 * {
 *   'com.apple.developer.healthkit': true,
 *   'com.apple.developer.in-app-payments': ['merchant.com.example.development'],
 * }
 * ```
 *
 * @param bundleId bundle identifier object
 * @param entitlements JSON representation of the entitlements plist
 * @returns
 */
export async function syncCapabilitiesForEntitlementsAsync(
  bundleId: BundleId,
  entitlements: JSONObject = {}
): Promise<{ enabled: string[]; disabled: string[] }> {
  if (EXPO_NO_CAPABILITY_SYNC) {
    return { enabled: [], disabled: [] };
  }
  const currentCapabilities = await bundleId.getBundleIdCapabilitiesAsync();
  if (Log.isDebug) {
    Log.log(`Current remote capabilities:\n${JSON.stringify(currentCapabilities, null, 2)}`);
    Log.log(`\nCurrent local entitlements:\n${JSON.stringify(entitlements, null, 2)}`);
  }

  const { enabledCapabilityNames, request, remainingCapabilities } = getCapabilitiesToEnable(
    currentCapabilities,
    entitlements
  );

  const { disabledCapabilityNames, request: modifiedRequest } = getCapabilitiesToDisable(
    bundleId,
    remainingCapabilities,
    request
  );

  if (modifiedRequest.length) {
    await bundleId.updateBundleIdCapabilityAsync(modifiedRequest);
  }

  return { enabled: enabledCapabilityNames, disabled: disabledCapabilityNames };
}

function getCapabilitiesToEnable(
  currentCapabilities: BundleIdCapability[],
  entitlements: JSONObject
) {
  const enabledCapabilityNames: string[] = [];
  const request: { capabilityType: CapabilityType; option: any }[] = [];
  const remainingCapabilities = [...currentCapabilities];
  for (const [key, value] of Object.entries(entitlements)) {
    const staticCapabilityInfo = CapabilityMapping.find(
      capability => capability.entitlement === key
    );

    if (!staticCapabilityInfo) {
      if (Log.isDebug) {
        Log.log(`Skipping entitlement that is not supported by EAS: ${key}`);
      }
      continue;
    }

    const existingIndex = currentCapabilities.findIndex(existing =>
      existing.isType(staticCapabilityInfo.capability)
    );
    const existing = existingIndex > -1 ? remainingCapabilities[existingIndex] : null;

    // Only skip if the existing capability is a simple boolean value,
    // if it has more complex settings then we should always update it.
    // If the `existing.attributes.settings` object is defined, then we can determine that it has extra configuration.
    if (existing && existing?.attributes.settings == null) {
      // Remove the item from the list of capabilities so we don't disable it.
      remainingCapabilities.splice(existingIndex, 1);
      if (Log.isDebug) {
        Log.log(`Skipping existing capability: ${key} (${staticCapabilityInfo.name})`);
      }
      continue;
    }

    if (!staticCapabilityInfo.validateOptions(value)) {
      throw new Error(`iOS entitlement "${key}" has invalid value "${value}".`);
    }
    enabledCapabilityNames.push(staticCapabilityInfo.name);

    const option = staticCapabilityInfo.getOptions(value!, entitlements);

    request.push({
      capabilityType: staticCapabilityInfo.capability,
      option,
    });
  }

  return { enabledCapabilityNames, request, remainingCapabilities };
}

function getCapabilitiesToDisable(
  bundleId: BundleId,
  currentCapabilities: BundleIdCapability[],
  request: { capabilityType: CapabilityType; option: any }[]
) {
  const disabledCapabilityNames: string[] = [];

  // Disable any extras that aren't present, this functionality is kinda unreliable because managed apps
  // might be enabling capabilities in modifiers.

  for (const existingCapability of currentCapabilities) {
    // Special case APNS because it's always enabled in Expo,
    // GC and IAP are always enabled in apps by default so we should avoid modifying them.
    if (
      existingCapability.isType(CapabilityType.IN_APP_PURCHASE) ||
      existingCapability.isType(CapabilityType.PUSH_NOTIFICATIONS) ||
      existingCapability.isType(CapabilityType.GAME_CENTER)
    ) {
      continue;
    }

    if (existingCapability.attributes) {
      let adjustedType: string | undefined = existingCapability.attributes.capabilityType;
      if (!adjustedType) {
        adjustedType = existingCapability.id.replace(`${bundleId.id}_`, '');
      }

      // Only disable capabilities that we handle,
      // this enables devs to turn on capabilities outside of EAS without worrying about us disabling them.
      const staticCapabilityInfo = CapabilityMapping.find(
        capability => capability.capability === adjustedType
      );
      if (
        staticCapabilityInfo &&
        !request.find(
          request => request.capabilityType && existingCapability.isType(request.capabilityType)
        )
      ) {
        request.push({
          // @ts-ignore
          capabilityType: adjustedType,
          option: CapabilityTypeOption.OFF,
        });

        disabledCapabilityNames.push(staticCapabilityInfo.name);
      }
    }
  }

  return { disabledCapabilityNames, request };
}

// NOTE(Bacon): From manually toggling values in Xcode and checking the git diff and network requests.
// Last Updated: May 5th, 2021
// https://developer.apple.com/documentation/bundleresources/entitlements
export const CapabilityMapping: {
  name: string;
  entitlement: string;
  capability: CapabilityType;
  validateOptions: (options: any) => boolean;
  getOptions: GetOptionsMethod;
  options?: undefined;
}[] = [
  {
    name: 'HomeKit',
    entitlement: 'com.apple.developer.homekit',
    capability: CapabilityType.HOME_KIT,
    validateOptions: validateBooleanOptions,
    getOptions: getBooleanOptions,
  },
  {
    name: 'Hotspot',
    entitlement: 'com.apple.developer.networking.HotspotConfiguration',
    capability: CapabilityType.HOT_SPOT,
    validateOptions: validateBooleanOptions,
    getOptions: getBooleanOptions,
  },
  {
    name: 'Multipath',
    entitlement: 'com.apple.developer.networking.multipath',
    capability: CapabilityType.MULTIPATH,
    validateOptions: validateBooleanOptions,
    getOptions: getBooleanOptions,
  },
  {
    name: 'SiriKit',
    entitlement: 'com.apple.developer.siri',
    capability: CapabilityType.SIRI_KIT,
    validateOptions: validateBooleanOptions,
    getOptions: getBooleanOptions,
  },
  {
    name: 'Wireless Accessory Configuration',
    entitlement: 'com.apple.external-accessory.wireless-configuration',
    capability: CapabilityType.WIRELESS_ACCESSORY,
    validateOptions: validateBooleanOptions,
    getOptions: getBooleanOptions,
  },
  {
    name: 'Extended Virtual Address Space',
    entitlement: 'com.apple.developer.kernel.extended-virtual-addressing',
    capability: CapabilityType.EXTENDED_VIRTUAL_ADDRESSING,
    validateOptions: validateBooleanOptions,
    getOptions: getBooleanOptions,
  },
  {
    name: 'Access WiFi Information',
    entitlement: 'com.apple.developer.networking.wifi-info',
    capability: CapabilityType.ACCESS_WIFI,
    validateOptions: validateBooleanOptions,
    getOptions: getBooleanOptions,
  },
  {
    name: 'Associated Domains',
    entitlement: 'com.apple.developer.associated-domains',
    capability: CapabilityType.ASSOCIATED_DOMAINS,
    validateOptions: validateStringArrayOptions,
    getOptions: getDefinedOptions,
  },
  {
    name: 'AutoFill Credential Provider',
    entitlement: 'com.apple.developer.authentication-services.autofill-credential-provider',
    capability: CapabilityType.AUTO_FILL_CREDENTIAL,
    validateOptions: validateBooleanOptions,
    getOptions: getBooleanOptions,
  },
  {
    name: 'HealthKit',
    entitlement: 'com.apple.developer.healthkit',
    capability: CapabilityType.HEALTH_KIT,
    validateOptions: validateBooleanOptions,
    getOptions: getBooleanOptions,
  },
  //   {
  //     // ?? -- adds UIRequiredDeviceCapabilities gamekit
  //     // Always locked on in dev portal
  //     name: 'Game Center',
  //     entitlement: 'com.apple.developer.game-center',
  //     capability: CapabilityType.GAME_CENTER,
  //     validateOptions: validateBooleanOptions,
  //     getOptions: getBooleanOptions,
  //   },
  {
    name: 'App Groups',
    entitlement: 'com.apple.security.application-groups',
    capability: CapabilityType.APP_GROUP,
    // Ex: ['group.CY-A5149AC2-49FC-11E7-B3F3-0335A16FFB8D.com.cydia.Extender']
    validateOptions: validateStringArrayOptions,
    getOptions: getDefinedOptions,
  },
  {
    name: 'Apple Pay Payment Processing',
    entitlement: 'com.apple.developer.in-app-payments',
    capability: CapabilityType.APPLE_PAY,
    // Ex: ['merchant.com.example.development']
    validateOptions: validateStringArrayOptions,
    getOptions: getDefinedOptions,
  },
  {
    name: 'iCloud',
    entitlement: 'com.apple.developer.icloud-container-identifiers',
    capability: CapabilityType.ICLOUD,
    validateOptions: validateStringArrayOptions,
    // Only supports Xcode +6, 5 could be added if needed.
    getOptions: getDefinedOptions,
  },
  {
    name: 'ClassKit',
    entitlement: 'com.apple.developer.ClassKit-environment',
    capability: CapabilityType.CLASS_KIT,
    validateOptions: validateDevProdString,
    getOptions: getDefinedOptions,
  },
  {
    name: 'Communication Notifications',
    entitlement: 'com.apple.developer.usernotifications.communication',
    capability: CapabilityType.USER_NOTIFICATIONS_COMMUNICATION,
    validateOptions: validateBooleanOptions,
    getOptions: getBooleanOptions,
  },
  {
    name: 'Time Sensitive Notifications',
    entitlement: 'com.apple.developer.usernotifications.time-sensitive',
    capability: CapabilityType.USER_NOTIFICATIONS_TIME_SENSITIVE,
    validateOptions: validateBooleanOptions,
    getOptions: getBooleanOptions,
  },
  {
    name: 'Group Activities',
    entitlement: 'com.apple.developer.group-session',
    capability: CapabilityType.GROUP_ACTIVITIES,
    validateOptions: validateBooleanOptions,
    getOptions: getBooleanOptions,
  },
  {
    name: 'Family Controls',
    entitlement: 'com.apple.developer.family-controls',
    capability: CapabilityType.FAMILY_CONTROLS,
    validateOptions: validateBooleanOptions,
    getOptions: getBooleanOptions,
  },
  {
    // https://developer.apple.com/documentation/bundleresources/entitlements/com_apple_developer_default-data-protection
    name: 'Data Protection',
    entitlement: 'com.apple.developer.default-data-protection',
    capability: CapabilityType.DATA_PROTECTION,
    validateOptions: createValidateStringOptions([
      'NSFileProtectionCompleteUnlessOpen',
      'NSFileProtectionCompleteUntilFirstUserAuthentication',
      'NSFileProtectionNone',
      'NSFileProtectionComplete',
    ]),
    getOptions(entitlement) {
      if (entitlement === 'NSFileProtectionComplete') {
        return CapabilityTypeDataProtectionOption.COMPLETE_PROTECTION;
      } else if (entitlement === 'NSFileProtectionCompleteUnlessOpen') {
        return CapabilityTypeDataProtectionOption.PROTECTED_UNLESS_OPEN;
      } else if (entitlement === 'NSFileProtectionCompleteUntilFirstUserAuthentication') {
        return CapabilityTypeDataProtectionOption.PROTECTED_UNTIL_FIRST_USER_AUTH;
      }
      // NSFileProtectionNone isn't documented, not sure how to handle
      throw new Error(
        `iOS entitlement "com.apple.developer.default-data-protection" is using unsupported value "${entitlement}"`
      );
    },
  },
  {
    // Deprecated
    name: 'Inter-App Audio',
    entitlement: 'inter-app-audio',
    capability: CapabilityType.INTER_APP_AUDIO,
    validateOptions: validateBooleanOptions,
    getOptions: getBooleanOptions,
  },
  {
    // https://developer.apple.com/documentation/bundleresources/entitlements/com_apple_developer_networking_networkextension
    name: 'Network Extensions',
    entitlement: 'com.apple.developer.networking.networkextension',
    capability: CapabilityType.NETWORK_EXTENSIONS,
    validateOptions: createValidateStringArrayOptions([
      'dns-proxy',
      'app-proxy-provider',
      'content-filter-provider',
      'packet-tunnel-provider',
      'dns-proxy-systemextension',
      'app-proxy-provider-systemextension',
      'content-filter-provider-systemextension',
      'packet-tunnel-provider-systemextension',
      'dns-settings',
      'app-push-provider',
    ]),
    getOptions: getDefinedOptions,
  },
  {
    // https://developer.apple.com/documentation/bundleresources/entitlements/com_apple_developer_nfc_readersession_formats
    name: 'NFC Tag Reading',
    entitlement: 'com.apple.developer.nfc.readersession.formats',
    capability: CapabilityType.NFC_TAG_READING,
    // Technically it seems only `TAG` is allowed, but many apps and packages tell users to add `NDEF` as well.
    validateOptions: createValidateStringArrayOptions(['NDEF', 'TAG']),
    getOptions: getDefinedOptions,
  },
  {
    name: 'Personal VPN',
    entitlement: 'com.apple.developer.networking.vpn.api',
    capability: CapabilityType.PERSONAL_VPN,
    // Ex: ['allow-vpn']
    validateOptions: createValidateStringArrayOptions(['allow-vpn']),
    getOptions: getDefinedOptions,
  },
  {
    // https://developer.apple.com/documentation/bundleresources/entitlements/com_apple_developer_networking_vpn_api
    name: 'Push Notifications',
    entitlement: 'aps-environment',
    capability: CapabilityType.PUSH_NOTIFICATIONS,
    validateOptions: validateDevProdString,
    getOptions: getDefinedOptions,
  },
  {
    name: 'Wallet',
    entitlement: 'com.apple.developer.pass-type-identifiers',
    capability: CapabilityType.WALLET,
    // Ex: ['$(TeamIdentifierPrefix)*']
    validateOptions: validateStringArrayOptions,
    getOptions: getDefinedOptions,
  },
  {
    name: 'Sign In with Apple',
    entitlement: 'com.apple.developer.applesignin',
    capability: CapabilityType.APPLE_ID_AUTH,
    // Ex: ['Default']
    validateOptions: createValidateStringArrayOptions(['Default']),
    getOptions: getDefinedOptions,
  },
  {
    name: 'Fonts',
    entitlement: 'com.apple.developer.user-fonts',
    capability: CapabilityType.FONT_INSTALLATION,
    validateOptions: createValidateStringArrayOptions(['app-usage', 'system-installation']),
    getOptions: getDefinedOptions,
  },
  {
    // Not in Xcode
    // https://developer.apple.com/documentation/devicecheck/preparing_to_use_the_app_attest_service
    // https://developer.apple.com/documentation/bundleresources/entitlements/com_apple_developer_devicecheck_appattest-environment
    name: 'App Attest',
    entitlement: 'com.apple.developer.devicecheck.appattest-environment',
    capability: CapabilityType.APP_ATTEST,
    validateOptions: validateDevProdString,
    getOptions: getDefinedOptions,
  },

  // These don't appear to have entitlements, so it's unclear how we can automatically enable / disable them at this time.
  // TODO: Maybe add a warning about manually enabling features?
  // ?? -- links `StoreKit.framework`
  // Always locked on in dev portal
  //   {
  //     entitlement: '',
  //     name: 'In-App Purchase',
  //     capability: CapabilityType.IN_APP_PURCHASE,
  //   },
  //   {
  //     entitlement: '',
  //     name: 'FileProvider TestingMode',
  //     capability: 'FILEPROVIDER_TESTINGMODE',
  //   },
  //   {
  //     entitlement: '',
  //     name: 'HLS Interstitial Previews',
  //     capability: 'HLS_INTERSTITIAL_PREVIEW',
  //   },
  //   {
  //     entitlement: '',
  //     name: 'Low Latency HLS',
  //     capability: 'COREMEDIA_HLS_LOW_LATENCY',
  //   },
  //   {
  //     entitlement: '',
  //     name: 'MDM Managed Associated Domains',
  //     capability: 'MDM_MANAGED_ASSOCIATED_DOMAINS',
  //   },

  // "Game Controllers" doesn't appear in Dev Portal but it does show up in Xcode,
  // toggling in Xcode causes no network request to be sent.
  // Therefore it seems that it's a mistake in Xcode,
  // the key `GCSupportsControllerUserInteraction` just needs to be present in Info.plist

  // "Keychain Sharing" doesn't appear in Dev Portal but it does show up in Xcode,
  // toggling in Xcode causes no network request to be sent.
  // Adding to Xcode puts 'keychain-access-groups' into the entitlements so
  // it's not clear if it needs to be updated.

  // "Contact Notes" requires the user to ask Apple in a form:
  // https://developer.apple.com/contact/request/contact-note-field
  // com.apple.developer.contacts.notes: https://developer.apple.com/documentation/bundleresources/entitlements/com_apple_developer_contacts_notes/

  // "Exposure Notification" requires the user to ask Apple in a form:
  // https://developer.apple.com/contact/request/exposure-notification-entitlement
  // com.apple.developer.exposure-notification: https://developer.apple.com/documentation/bundleresources/entitlements/com_apple_developer_exposure-notification/
];
