import {
  AppGroup,
  BundleIdCapability,
  CapabilityType,
  CapabilityTypeDataProtectionOption,
  CapabilityTypeOption,
  CapabilityTypePushNotificationsOption,
  CloudContainer,
  MerchantId,
} from '@expo/apple-utils';
import { JSONObject, JSONValue } from '@expo/json-file';
import { invariant } from 'graphql/jsutils/invariant';
import nullthrows from 'nullthrows';

import Log from '../../../log';

const validateBooleanOptions = (options: any): boolean => {
  return typeof options === 'boolean';
};

const validatePrefixedStringArrayOptions =
  (prefix: string) =>
  (options: any): boolean => {
    return (
      Array.isArray(options) &&
      options.every(option => typeof option === 'string' && option.startsWith(prefix))
    );
  };

const validateStringArrayOptions = (options: any): boolean => {
  return Array.isArray(options) && options.every(option => typeof option === 'string');
};

const createValidateStringOptions =
  (allowed: string[]) =>
  (options: any): boolean => {
    return allowed.includes(options);
  };

const createValidateStringArrayOptions =
  (allowed: string[]) =>
  (options: any): boolean => {
    return Array.isArray(options) && options.every(option => allowed.includes(option));
  };

const validateDevProdString = createValidateStringOptions(['development', 'production']);

const skipOp = { op: 'skip' } as const;
const disableOp = { op: 'disable' } as const;
const enableOp = { op: 'enable', option: CapabilityTypeOption.ON } as const;

type GetSyncOperation = (opts: {
  existingRemote: BundleIdCapability | null;
  entitlementValue: JSONValue;
  entitlements: JSONObject;
  additionalOptions: {
    usesBroadcastPushNotifications: boolean;
  };
}) => { op: 'enable'; option: JSONValue } | typeof skipOp | typeof disableOp;

const getBooleanSyncOperation: GetSyncOperation = ({ existingRemote, entitlementValue }) => {
  if (existingRemote) {
    // If the remote capability exists, we only disable it if the value is false.
    // Otherwise, we skip it.
    if ('enabled' in existingRemote.attributes) {
      return existingRemote.attributes['enabled'] === entitlementValue ? skipOp : disableOp;
    }
    return existingRemote.attributes.settings === null ? skipOp : enableOp;
  } else {
    return entitlementValue === false ? skipOp : enableOp;
  }
};

const getDefinedValueSyncOperation: GetSyncOperation = ({ existingRemote }) => {
  if (!existingRemote) {
    // If the remote capability does not exist, we create it.
    return enableOp;
  }
  return existingRemote.attributes.settings === null ? skipOp : enableOp;
};

const capabilityWithSettingsSyncOperation: GetSyncOperation = ({
  existingRemote,
  entitlementValue,
}) => {
  // settings are defined for only a few capabilities: iCloud, data protection and Sign in with Apple
  // https://developer.apple.com/documentation/appstoreconnectapi/capabilitysetting
  if (!existingRemote) {
    return enableOp;
  }
  const { attributes, id } = existingRemote;
  if ('enabled' in attributes) {
    // the `enabled` field should be available as per https://developer.apple.com/documentation/appstoreconnectapi/capabilitysetting
    const existingEnabled = attributes.enabled === true;

    // If both are enabled and the existing one has settings, skip the update
    if (existingEnabled && entitlementValue && attributes.settings) {
      return skipOp;
    }

    const newOption = entitlementValue ? CapabilityTypeOption.ON : CapabilityTypeOption.OFF;
    // If the states don't match, we need to update
    const newEnabled = newOption === CapabilityTypeOption.ON;
    return existingEnabled === newEnabled ? skipOp : { op: 'enable', option: newOption };
  } else {
    if (Log.isDebug) {
      Log.log(
        `Expected the "enabled" attribute in ${id} but it was not present (attributes: ${JSON.stringify(
          attributes,
          null,
          2
        )}). Will skip syncing this capability.`
      );
    }
    return skipOp;
  }
};

export type CapabilityClassifier = {
  name: string;
  entitlement: string;
  capability: CapabilityType;
  validateOptions: (options: any) => boolean;
  capabilityIdModel?: typeof MerchantId;
  getSyncOperation: GetSyncOperation;
  capabilityIdPrefix?: string;
  options?: undefined;
};

// NOTE(Bacon): From manually toggling values in Xcode and checking the git diff and network requests.
// Last Updated: July 22nd, 2021
// https://developer-mdn.apple.com/documentation/bundleresources/entitlements
export const CapabilityMapping: CapabilityClassifier[] = [
  {
    name: 'HomeKit',
    entitlement: 'com.apple.developer.homekit',
    capability: CapabilityType.HOME_KIT,
    validateOptions: validateBooleanOptions,
    getSyncOperation: getBooleanSyncOperation,
  },
  {
    name: 'Hotspot',
    entitlement: 'com.apple.developer.networking.HotspotConfiguration',
    capability: CapabilityType.HOT_SPOT,
    validateOptions: validateBooleanOptions,
    getSyncOperation: getBooleanSyncOperation,
  },
  {
    name: 'Multipath',
    entitlement: 'com.apple.developer.networking.multipath',
    capability: CapabilityType.MULTIPATH,
    validateOptions: validateBooleanOptions,
    getSyncOperation: getBooleanSyncOperation,
  },
  {
    name: 'SiriKit',
    entitlement: 'com.apple.developer.siri',
    capability: CapabilityType.SIRI_KIT,
    validateOptions: validateBooleanOptions,
    getSyncOperation: getBooleanSyncOperation,
  },
  {
    name: 'Wireless Accessory Configuration',
    entitlement: 'com.apple.external-accessory.wireless-configuration',
    capability: CapabilityType.WIRELESS_ACCESSORY,
    validateOptions: validateBooleanOptions,
    getSyncOperation: getBooleanSyncOperation,
  },
  {
    name: 'Extended Virtual Address Space',
    entitlement: 'com.apple.developer.kernel.extended-virtual-addressing',
    capability: CapabilityType.EXTENDED_VIRTUAL_ADDRESSING,
    validateOptions: validateBooleanOptions,
    getSyncOperation: getBooleanSyncOperation,
  },
  {
    name: 'Access WiFi Information',
    entitlement: 'com.apple.developer.networking.wifi-info',
    capability: CapabilityType.ACCESS_WIFI,
    validateOptions: validateBooleanOptions,
    getSyncOperation: getBooleanSyncOperation,
  },
  {
    name: 'Associated Domains',
    entitlement: 'com.apple.developer.associated-domains',
    capability: CapabilityType.ASSOCIATED_DOMAINS,
    validateOptions: validateStringArrayOptions,
    getSyncOperation: getDefinedValueSyncOperation,
  },
  {
    name: 'AutoFill Credential Provider',
    entitlement: 'com.apple.developer.authentication-services.autofill-credential-provider',
    capability: CapabilityType.AUTO_FILL_CREDENTIAL,
    validateOptions: validateBooleanOptions,
    getSyncOperation: getBooleanSyncOperation,
  },
  {
    name: 'HealthKit',
    entitlement: 'com.apple.developer.healthkit',
    capability: CapabilityType.HEALTH_KIT,
    validateOptions: validateBooleanOptions,
    getSyncOperation: getBooleanSyncOperation,
  },
  //   {
  //     // ?? -- adds UIRequiredDeviceCapabilities gamekit
  //     // Always locked on in dev portal
  //     name: 'Game Center',
  //     entitlement: 'com.apple.developer.game-center',
  //     capability: CapabilityType.GAME_CENTER,
  //     validateOptions: validateBooleanOptions,
  //         getSyncOperation: getBooleanSyncOperation,
  //   },
  {
    name: 'App Groups',
    entitlement: 'com.apple.security.application-groups',
    capability: CapabilityType.APP_GROUP,
    // Ex: ['group.CY-A5149AC2-49FC-11E7-B3F3-0335A16FFB8D.com.cydia.Extender']
    validateOptions: validatePrefixedStringArrayOptions('group.'),
    getSyncOperation: getDefinedValueSyncOperation,
    capabilityIdModel: AppGroup,
    capabilityIdPrefix: 'group.',
  },
  {
    name: 'Apple Pay Payment Processing',
    entitlement: 'com.apple.developer.in-app-payments',
    capability: CapabilityType.APPLE_PAY,
    // Ex: ['merchant.com.example.development']
    validateOptions: validatePrefixedStringArrayOptions('merchant.'),
    getSyncOperation: getDefinedValueSyncOperation,
    capabilityIdModel: MerchantId,
    capabilityIdPrefix: 'merchant.',
  },
  {
    name: 'iCloud',
    entitlement: 'com.apple.developer.icloud-container-identifiers',
    capability: CapabilityType.ICLOUD,
    validateOptions: validatePrefixedStringArrayOptions('iCloud.'),
    // Only supports Xcode +6
    getSyncOperation: capabilityWithSettingsSyncOperation,
    capabilityIdModel: CloudContainer,
    capabilityIdPrefix: 'iCloud.',
  },
  {
    name: 'ClassKit',
    entitlement: 'com.apple.developer.ClassKit-environment',
    capability: CapabilityType.CLASS_KIT,
    validateOptions: validateDevProdString,
    getSyncOperation: getDefinedValueSyncOperation,
  },
  {
    name: 'Communication Notifications',
    entitlement: 'com.apple.developer.usernotifications.communication',
    capability: CapabilityType.USER_NOTIFICATIONS_COMMUNICATION,
    validateOptions: validateBooleanOptions,
    getSyncOperation: getBooleanSyncOperation,
  },
  {
    name: 'Time Sensitive Notifications',
    entitlement: 'com.apple.developer.usernotifications.time-sensitive',
    capability: CapabilityType.USER_NOTIFICATIONS_TIME_SENSITIVE,
    validateOptions: validateBooleanOptions,
    getSyncOperation: getBooleanSyncOperation,
  },
  {
    name: 'Group Activities',
    entitlement: 'com.apple.developer.group-session',
    capability: CapabilityType.GROUP_ACTIVITIES,
    validateOptions: validateBooleanOptions,
    getSyncOperation: getBooleanSyncOperation,
  },
  {
    name: 'Family Controls',
    entitlement: 'com.apple.developer.family-controls',
    capability: CapabilityType.FAMILY_CONTROLS,
    validateOptions: validateBooleanOptions,
    getSyncOperation: getBooleanSyncOperation,
  },
  {
    // https://developer-mdn.apple.com/documentation/bundleresources/entitlements/com_apple_developer_default-data-protection
    name: 'Data Protection',
    entitlement: 'com.apple.developer.default-data-protection',
    capability: CapabilityType.DATA_PROTECTION,
    validateOptions: createValidateStringOptions([
      'NSFileProtectionCompleteUnlessOpen',
      'NSFileProtectionCompleteUntilFirstUserAuthentication',
      'NSFileProtectionNone',
      'NSFileProtectionComplete',
    ]),
    getSyncOperation: ({ existingRemote, entitlementValue: entitlement }) => {
      const newValue = (() => {
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
      })();
      const enableOp = { op: 'enable', option: newValue } as const;
      if (!existingRemote) {
        return enableOp;
      }
      invariant(existingRemote.attributes.settings?.[0].key === 'DATA_PROTECTION_PERMISSION_LEVEL');
      const oldValue = existingRemote.attributes.settings[0]?.options?.[0]?.key;
      return oldValue === newValue ? skipOp : enableOp;
    },
  },
  {
    // Deprecated
    name: 'Inter-App Audio',
    entitlement: 'inter-app-audio',
    capability: CapabilityType.INTER_APP_AUDIO,
    validateOptions: validateBooleanOptions,
    getSyncOperation: getBooleanSyncOperation,
  },
  {
    // https://developer-mdn.apple.com/documentation/bundleresources/entitlements/com_apple_developer_networking_networkextension
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
    getSyncOperation: getDefinedValueSyncOperation,
  },
  {
    // https://developer-mdn.apple.com/documentation/bundleresources/entitlements/com_apple_developer_nfc_readersession_formats
    name: 'NFC Tag Reading',
    entitlement: 'com.apple.developer.nfc.readersession.formats',
    capability: CapabilityType.NFC_TAG_READING,
    // Technically it seems only `TAG` is allowed, but many apps and packages tell users to add `NDEF` as well.
    validateOptions: createValidateStringArrayOptions(['NDEF', 'TAG']),
    getSyncOperation: getDefinedValueSyncOperation,
  },
  {
    name: 'Personal VPN',
    entitlement: 'com.apple.developer.networking.vpn.api',
    capability: CapabilityType.PERSONAL_VPN,
    // Ex: ['allow-vpn']
    validateOptions: createValidateStringArrayOptions(['allow-vpn']),
    getSyncOperation: getDefinedValueSyncOperation,
  },
  {
    // https://developer-mdn.apple.com/documentation/bundleresources/entitlements/com_apple_developer_networking_vpn_api
    name: 'Push Notifications',
    // com.apple.developer.aps-environment
    entitlement: 'aps-environment',
    capability: CapabilityType.PUSH_NOTIFICATIONS,
    validateOptions: validateDevProdString,
    getSyncOperation: ({
      existingRemote,
      entitlementValue: entitlement,
      additionalOptions: { usesBroadcastPushNotifications },
    }) => {
      const newOption = (() => {
        const option = entitlement ? CapabilityTypeOption.ON : CapabilityTypeOption.OFF;
        if (option === CapabilityTypeOption.ON && usesBroadcastPushNotifications) {
          return CapabilityTypePushNotificationsOption.PUSH_NOTIFICATION_FEATURE_BROADCAST;
        }
        return option;
      })();
      const createOp = { op: 'enable', option: newOption } as const;
      if (!existingRemote) {
        // If the remote capability does not exist, we create it.
        return createOp;
      }
      // For push notifications, we should always update the capability if
      // - settings are not defined in the existing capability, but usesBroadcastPushNotifications is enabled (we want to add settings for this capability)
      // - settings are defined in the existing capability, but usesBroadcastPushNotifications is disabled (we want to remove settings for this capability)
      const noSettingsAttributes = existingRemote.attributes.settings == null;
      return !noSettingsAttributes === usesBroadcastPushNotifications ? skipOp : createOp;
    },
  },
  {
    name: 'Wallet',
    entitlement: 'com.apple.developer.pass-type-identifiers',
    capability: CapabilityType.WALLET,
    // Ex: ['$(TeamIdentifierPrefix)*']
    validateOptions: validateStringArrayOptions,
    getSyncOperation: getDefinedValueSyncOperation,
  },
  {
    name: 'Sign In with Apple',
    entitlement: 'com.apple.developer.applesignin',
    capability: CapabilityType.APPLE_ID_AUTH,
    // Ex: ['Default']
    validateOptions: createValidateStringArrayOptions(['Default']),
    getSyncOperation: capabilityWithSettingsSyncOperation,
  },
  {
    name: 'Fonts',
    entitlement: 'com.apple.developer.user-fonts',
    capability: CapabilityType.FONT_INSTALLATION,
    validateOptions: createValidateStringArrayOptions(['app-usage', 'system-installation']),
    getSyncOperation: getDefinedValueSyncOperation,
  },
  {
    name: 'Apple Pay Later Merchandising',
    entitlement: 'com.apple.developer.pay-later-merchandising',
    capability: CapabilityType.APPLE_PAY_LATER_MERCHANDISING,
    validateOptions: createValidateStringArrayOptions(['payinfour-merchandising']),
    getSyncOperation: getDefinedValueSyncOperation,
  },
  {
    name: 'Sensitive Content Analysis',
    entitlement: 'com.apple.developer.sensitivecontentanalysis.client',
    capability: CapabilityType.SENSITIVE_CONTENT_ANALYSIS,
    validateOptions: createValidateStringArrayOptions(['analysis']),
    getSyncOperation: getDefinedValueSyncOperation,
  },
  {
    // Not in Xcode
    // https://developer-mdn.apple.com/documentation/devicecheck/preparing_to_use_the_app_attest_service
    // https://developer-mdn.apple.com/documentation/bundleresources/entitlements/com_apple_developer_devicecheck_appattest-environment
    name: 'App Attest',
    entitlement: 'com.apple.developer.devicecheck.appattest-environment',
    capability: CapabilityType.APP_ATTEST,
    validateOptions: validateDevProdString,
    getSyncOperation: getDefinedValueSyncOperation,
  },
  {
    entitlement: 'com.apple.developer.coremedia.hls.low-latency',
    name: 'Low Latency HLS',
    capability: CapabilityType.HLS_LOW_LATENCY,
    validateOptions: validateBooleanOptions,
    getSyncOperation: getBooleanSyncOperation,
  },
  {
    entitlement: 'com.apple.developer.associated-domains.mdm-managed',
    name: 'MDM Managed Associated Domains',
    capability: CapabilityType.MDM_MANAGED_ASSOCIATED_DOMAINS,
    validateOptions: validateBooleanOptions,
    getSyncOperation: getBooleanSyncOperation,
  },
  {
    entitlement: 'com.apple.developer.fileprovider.testing-mode',
    name: 'FileProvider TestingMode',
    capability: CapabilityType.FILE_PROVIDER_TESTING_MODE,
    validateOptions: validateBooleanOptions,
    getSyncOperation: getBooleanSyncOperation,
  },
  {
    entitlement: 'com.apple.developer.healthkit.recalibrate-estimates',
    name: 'Recalibrate Estimates',
    capability: CapabilityType.HEALTH_KIT_RECALIBRATE_ESTIMATES,
    validateOptions: validateBooleanOptions,
    getSyncOperation: getBooleanSyncOperation,
  },
  {
    entitlement: 'com.apple.developer.maps',
    name: 'Maps',
    capability: CapabilityType.MAPS,
    validateOptions: validateBooleanOptions,
    getSyncOperation: getBooleanSyncOperation,
  },
  {
    entitlement: 'com.apple.developer.user-management',
    name: 'TV Services',
    capability: CapabilityType.USER_MANAGEMENT,
    validateOptions: validateBooleanOptions,
    getSyncOperation: getBooleanSyncOperation,
  },
  {
    entitlement: 'com.apple.developer.networking.custom-protocol',
    name: 'Custom Network Protocol',
    capability: CapabilityType.NETWORK_CUSTOM_PROTOCOL,
    validateOptions: validateBooleanOptions,
    getSyncOperation: getBooleanSyncOperation,
  },
  {
    entitlement: 'com.apple.developer.system-extension.install',
    name: 'System Extension',
    capability: CapabilityType.SYSTEM_EXTENSION_INSTALL,
    validateOptions: validateBooleanOptions,
    getSyncOperation: getBooleanSyncOperation,
  },
  {
    entitlement: 'com.apple.developer.push-to-talk',
    name: 'Push to Talk',
    capability: CapabilityType.PUSH_TO_TALK,
    validateOptions: validateBooleanOptions,
    getSyncOperation: getBooleanSyncOperation,
  },
  {
    entitlement: 'com.apple.developer.driverkit.transport.usb',
    name: 'DriverKit USB Transport (development)',
    capability: CapabilityType.DRIVER_KIT_USB_TRANSPORT_PUB,
    validateOptions: validateBooleanOptions,
    getSyncOperation: getBooleanSyncOperation,
  },
  {
    entitlement: 'com.apple.developer.kernel.increased-memory-limit',
    name: 'Increased Memory Limit',
    capability: CapabilityType.INCREASED_MEMORY_LIMIT,
    validateOptions: validateBooleanOptions,
    getSyncOperation: getBooleanSyncOperation,
  },
  {
    entitlement: 'com.apple.developer.driverkit.communicates-with-drivers',
    name: 'Communicates with Drivers',
    capability: CapabilityType.DRIVER_KIT_COMMUNICATES_WITH_DRIVERS,
    validateOptions: validateBooleanOptions,
    getSyncOperation: getBooleanSyncOperation,
  },
  {
    entitlement: 'com.apple.developer.media-device-discovery-extension',
    name: 'Media Device Discovery',
    capability: CapabilityType.MEDIA_DEVICE_DISCOVERY,
    validateOptions: validateBooleanOptions,
    getSyncOperation: getBooleanSyncOperation,
  },
  {
    entitlement: 'com.apple.developer.driverkit.allow-third-party-userclients',
    name: 'DriverKit Allow Third Party UserClients',
    capability: CapabilityType.DRIVER_KIT_ALLOW_THIRD_PARTY_USER_CLIENTS,
    validateOptions: validateBooleanOptions,
    getSyncOperation: getBooleanSyncOperation,
  },
  {
    entitlement: 'com.apple.developer.weatherkit',
    name: 'WeatherKit',
    capability: CapabilityType.WEATHER_KIT,
    validateOptions: validateBooleanOptions,
    getSyncOperation: getBooleanSyncOperation,
  },
  {
    entitlement: 'com.apple.developer.on-demand-install-capable',
    name: 'On Demand Install Capable for App Clip Extensions',
    capability: CapabilityType.ON_DEMAND_INSTALL_EXTENSIONS,
    validateOptions: validateBooleanOptions,
    getSyncOperation: getBooleanSyncOperation,
  },
  {
    entitlement: 'com.apple.developer.driverkit.family.scsicontroller',
    name: 'DriverKit Family SCSIController (development)',
    capability: CapabilityType.DRIVER_KIT_FAMILY_SCSI_CONTROLLER_PUB,
    validateOptions: validateBooleanOptions,
    getSyncOperation: getBooleanSyncOperation,
  },
  {
    entitlement: 'com.apple.developer.driverkit.family.serial',
    name: 'DriverKit Family Serial (development)',
    capability: CapabilityType.DRIVER_KIT_FAMILY_SERIAL_PUB,
    validateOptions: validateBooleanOptions,
    getSyncOperation: getBooleanSyncOperation,
  },
  {
    entitlement: 'com.apple.developer.driverkit.family.networking',
    name: 'DriverKit Family Networking (development)',
    capability: CapabilityType.DRIVER_KIT_FAMILY_NETWORKING_PUB,
    validateOptions: validateBooleanOptions,
    getSyncOperation: getBooleanSyncOperation,
  },
  {
    entitlement: 'com.apple.developer.driverkit.family.hid.eventservice',
    name: 'DriverKit Family HID EventService (development)',
    capability: CapabilityType.DRIVER_KIT_FAMILY_HID_EVENT_SERVICE_PUB,
    validateOptions: validateBooleanOptions,
    getSyncOperation: getBooleanSyncOperation,
  },
  {
    entitlement: 'com.apple.developer.driverkit.family.hid.device',
    name: 'DriverKit Family HID Device (development)',
    capability: CapabilityType.DRIVER_KIT_FAMILY_HID_DEVICE_PUB,
    validateOptions: validateBooleanOptions,
    getSyncOperation: getBooleanSyncOperation,
  },
  {
    entitlement: 'com.apple.developer.driverkit',
    name: 'DriverKit for Development',
    capability: CapabilityType.DRIVER_KIT_PUBLIC,
    validateOptions: validateBooleanOptions,
    getSyncOperation: getBooleanSyncOperation,
  },
  {
    entitlement: 'com.apple.developer.driverkit.transport.hid',
    name: 'DriverKit Transport HID (development)',
    capability: CapabilityType.DRIVER_KIT_TRANSPORT_HID_PUB,
    validateOptions: validateBooleanOptions,
    getSyncOperation: getBooleanSyncOperation,
  },
  {
    entitlement: 'com.apple.developer.driverkit.family.audio',
    name: 'DriverKit Family Audio (development)',
    capability: CapabilityType.DRIVER_KIT_FAMILY_AUDIO_PUB,
    validateOptions: validateBooleanOptions,
    getSyncOperation: getBooleanSyncOperation,
  },
  {
    entitlement: 'com.apple.developer.shared-with-you',
    name: 'Shared with You',
    capability: CapabilityType.SHARED_WITH_YOU,
    validateOptions: validateBooleanOptions,
    getSyncOperation: getBooleanSyncOperation,
  },
  {
    entitlement: 'com.apple.developer.shared-with-you.collaboration',
    name: 'Messages Collaboration',
    capability: CapabilityType.MESSAGES_COLLABORATION,
    validateOptions: validateBooleanOptions,
    getSyncOperation: getBooleanSyncOperation,
  },
  {
    entitlement: 'com.apple.developer.submerged-shallow-depth-and-pressure',
    name: 'Shallow Depth and Pressure',
    capability: CapabilityType.SHALLOW_DEPTH_PRESSURE,
    validateOptions: validateBooleanOptions,
    getSyncOperation: getBooleanSyncOperation,
  },
  {
    entitlement: 'com.apple.developer.proximity-reader.identity.display',
    name: 'Tap to Present ID on iPhone (Display Only)',
    capability: CapabilityType.TAP_TO_DISPLAY_ID,
    validateOptions: validateBooleanOptions,
    getSyncOperation: getBooleanSyncOperation,
  },
  {
    entitlement: 'com.apple.developer.proximity-reader.payment.acceptance',
    name: 'Tap to Pay on iPhone',
    capability: CapabilityType.TAP_TO_PAY_ON_IPHONE,
    validateOptions: validateBooleanOptions,
    getSyncOperation: getBooleanSyncOperation,
  },
  {
    entitlement: 'com.apple.developer.matter.allow-setup-payload',
    name: 'Matter Allow Setup Payload',
    capability: CapabilityType.MATTER_ALLOW_SETUP_PAYLOAD,
    validateOptions: validateBooleanOptions,
    getSyncOperation: getBooleanSyncOperation,
  },
  {
    entitlement: 'com.apple.developer.journal.allow',
    name: 'Journaling Suggestions',
    capability: CapabilityType.JOURNALING_SUGGESTIONS,
    validateOptions: createValidateStringArrayOptions(['suggestions']),
    getSyncOperation: getDefinedValueSyncOperation,
  },
  {
    entitlement: 'com.apple.developer.managed-app-distribution.install-ui',
    name: 'Managed App Installation UI',
    capability: CapabilityType.MANAGED_APP_INSTALLATION_UI,
    validateOptions: createValidateStringArrayOptions(['managed-app']),
    getSyncOperation: getDefinedValueSyncOperation,
  },
  {
    entitlement: 'com.apple.developer.networking.slicing.appcategory',
    name: '5G Network Slicing',
    capability: CapabilityType.NETWORK_SLICING,
    validateOptions: createValidateStringArrayOptions([
      'gaming-6014',
      'communication-9000',
      'streaming-9001',
    ]),
    getSyncOperation: getDefinedValueSyncOperation,
  },
  {
    entitlement: 'com.apple.developer.networking.slicing.trafficcategory',
    name: '5G Network Slicing',
    capability: CapabilityType.NETWORK_SLICING,
    validateOptions: createValidateStringArrayOptions([
      'defaultslice-1',
      'video-2',
      'background-3',
      'voice-4',
      'callsignaling-5',
      'responsivedata-6',
      'avstreaming-7',
      'responsiveav-8',
    ]),
    getSyncOperation: getDefinedValueSyncOperation,
  },
  // VMNET

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
  //     name: 'HLS Interstitial Previews',
  //     capability: 'HLS_INTERSTITIAL_PREVIEW',
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
  // https://developer-mdn.apple.com/contact/request/contact-note-field
  // com.apple.developer.contacts.notes: https://developer-mdn.apple.com/documentation/bundleresources/entitlements/com_apple_developer_contacts_notes/

  // "Exposure Notification" requires the user to ask Apple in a form:
  // https://developer-mdn.apple.com/contact/request/exposure-notification-entitlement
  // com.apple.developer.exposure-notification: https://developer-mdn.apple.com/documentation/bundleresources/entitlements/com_apple_developer_exposure-notification/
];

export const associatedDomainsCapabilityType = nullthrows(
  CapabilityMapping.find(it => it.capability === CapabilityType.ASSOCIATED_DOMAINS)
);
