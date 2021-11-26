import { BundleIdCapability } from '@expo/apple-utils';

import {
  CapabilityMapping,
  assertValidOptions,
  syncCapabilitiesForEntitlementsAsync,
} from '../bundleIdCapabilities';

describe(assertValidOptions, () => {
  it(`adds a reason for asserting capability identifiers`, () => {
    const classifier = CapabilityMapping.find(
      ({ capabilityIdPrefix }) => capabilityIdPrefix === 'merchant.'
    )!;
    expect(() => assertValidOptions(classifier, ['foobar'])).toThrowError(
      /Expected an array of strings, where each string is prefixed with "merchant."/
    );
  });
});

describe(syncCapabilitiesForEntitlementsAsync, () => {
  it('enables all capabilities', async () => {
    const bundleId = {
      getBundleIdCapabilitiesAsync: jest.fn(() => []),
      updateBundleIdCapabilityAsync: jest.fn(),
      id: 'XXX',
    } as any;

    const results = await syncCapabilitiesForEntitlementsAsync(bundleId, {
      'com.apple.developer.healthkit': true,
      //   'com.apple.developer.healthkit.access': [],
      'com.apple.developer.in-app-payments': ['merchant.com.example.development'],
      'com.apple.developer.icloud-container-identifiers': [],
      'com.apple.developer.ClassKit-environment': 'development',
      'com.apple.developer.default-data-protection':
        'NSFileProtectionCompleteUntilFirstUserAuthentication',
      'com.apple.developer.networking.networkextension': ['dns-proxy'],
      'com.apple.developer.networking.vpn.api': ['allow-vpn'],
      'com.apple.developer.networking.HotspotConfiguration': true,
      'com.apple.developer.kernel.extended-virtual-addressing': true,
      'com.apple.developer.homekit': true,
      'com.apple.developer.networking.multipath': true,
      'com.apple.external-accessory.wireless-configuration': true,
      'inter-app-audio': true,
      'com.apple.developer.pass-type-identifiers': ['$(TeamIdentifierPrefix)*'],
      'com.apple.developer.user-fonts': ['app-usage'],
      'com.apple.developer.devicecheck.appattest-environment': 'development',
      'com.apple.developer.nfc.readersession.formats': ['NDEF', 'TAG'],
      'com.apple.developer.applesignin': ['Default'],
      'com.apple.developer.siri': true,
      'com.apple.developer.networking.wifi-info': true,
      'com.apple.developer.usernotifications.communication': true,
      'com.apple.developer.usernotifications.time-sensitive': true,
      'com.apple.developer.group-session': true,
      'com.apple.developer.family-controls': true,
      'com.apple.developer.authentication-services.autofill-credential-provider': true,
      //   'com.apple.developer.game-center': true,
      'com.apple.security.application-groups': [
        'group.CY-A5149AC2-49FC-11E7-B3F3-0335A16FFB8D.com.cydia.Extender',
      ],
    });

    expect(bundleId.updateBundleIdCapabilityAsync).toBeCalledWith([
      { capabilityType: 'HEALTHKIT', option: 'ON' },
      { capabilityType: 'APPLE_PAY', option: 'ON' },
      { capabilityType: 'ICLOUD', option: 'ON' },
      { capabilityType: 'CLASSKIT', option: 'ON' },
      { capabilityType: 'DATA_PROTECTION', option: 'PROTECTED_UNTIL_FIRST_USER_AUTH' },
      { capabilityType: 'NETWORK_EXTENSIONS', option: 'ON' },
      { capabilityType: 'PERSONAL_VPN', option: 'ON' },
      { capabilityType: 'HOT_SPOT', option: 'ON' },
      { capabilityType: 'EXTENDED_VIRTUAL_ADDRESSING', option: 'ON' },
      { capabilityType: 'HOMEKIT', option: 'ON' },
      { capabilityType: 'MULTIPATH', option: 'ON' },
      { capabilityType: 'WIRELESS_ACCESSORY_CONFIGURATION', option: 'ON' },
      { capabilityType: 'INTER_APP_AUDIO', option: 'ON' },
      { capabilityType: 'WALLET', option: 'ON' },
      { capabilityType: 'FONT_INSTALLATION', option: 'ON' },
      { capabilityType: 'APP_ATTEST', option: 'ON' },
      { capabilityType: 'NFC_TAG_READING', option: 'ON' },
      { capabilityType: 'APPLE_ID_AUTH', option: 'ON' },
      { capabilityType: 'SIRIKIT', option: 'ON' },
      { capabilityType: 'ACCESS_WIFI_INFORMATION', option: 'ON' },
      {
        capabilityType: 'USERNOTIFICATIONS_COMMUNICATION',
        option: 'ON',
      },
      {
        capabilityType: 'USERNOTIFICATIONS_TIMESENSITIVE',
        option: 'ON',
      },
      {
        capabilityType: 'GROUP_ACTIVITIES',
        option: 'ON',
      },
      {
        capabilityType: 'FAMILY_CONTROLS',
        option: 'ON',
      },
      { capabilityType: 'AUTOFILL_CREDENTIAL_PROVIDER', option: 'ON' },
      { capabilityType: 'APP_GROUPS', option: 'ON' },
    ]);

    expect(results.enabled).toStrictEqual([
      'HealthKit',
      'Apple Pay Payment Processing',
      'iCloud',
      'ClassKit',
      'Data Protection',
      'Network Extensions',
      'Personal VPN',
      'Hotspot',
      'Extended Virtual Address Space',
      'HomeKit',
      'Multipath',
      'Wireless Accessory Configuration',
      'Inter-App Audio',
      'Wallet',
      'Fonts',
      'App Attest',
      'NFC Tag Reading',
      'Sign In with Apple',
      'SiriKit',
      'Access WiFi Information',
      'Communication Notifications',
      'Time Sensitive Notifications',
      'Group Activities',
      'Family Controls',
      'AutoFill Credential Provider',
      'App Groups',
    ]);
    expect(results.disabled).toStrictEqual([]);
  });

  it('skips simple duplicates', async () => {
    const bundleId = {
      getBundleIdCapabilitiesAsync: jest.fn(() => [
        new BundleIdCapability({}, 'XXX_HEALTHKIT', { settings: null }),
      ]),
      updateBundleIdCapabilityAsync: jest.fn(),
      id: 'XXX',
    } as any;

    const results = await syncCapabilitiesForEntitlementsAsync(bundleId, {
      'com.apple.developer.healthkit': true,
    });

    expect(bundleId.updateBundleIdCapabilityAsync).not.toBeCalled();

    expect(results.enabled).toStrictEqual([]);
    expect(results.disabled).toStrictEqual([]);
  });

  // It's unclear what is happening in this issue, so for now we can provide a more
  // helpful error message until we can get a reproducible example.
  // https://github.com/expo/eas-cli/issues/740
  it('throw useful error message on unexpected error', async () => {
    const bundleId = {
      getBundleIdCapabilitiesAsync: jest.fn(() => []),
      updateBundleIdCapabilityAsync: jest.fn(() => {
        throw new Error(`bundle 'XXX333' cannot be deleted. Delete all the Apps`);
      }),
      attributes: {
        identifier: 'dev.expo.app',
      },
      id: 'XXX333',
    } as any;

    await expect(
      syncCapabilitiesForEntitlementsAsync(bundleId, {
        'com.apple.developer.healthkit': true,
      })
    ).rejects.toThrowError(
      `https://developer.apple.com/account/resources/identifiers/bundleId/edit/XXX333`
    );
  });

  it('cannot skip complex duplicates', async () => {
    const bundleId = {
      getBundleIdCapabilitiesAsync: jest.fn(() => [
        new BundleIdCapability({}, 'XXX_HEALTHKIT', { settings: [] }),
      ]),
      updateBundleIdCapabilityAsync: jest.fn(),
      id: 'XXX',
    } as any;

    const results = await syncCapabilitiesForEntitlementsAsync(bundleId, {
      'com.apple.developer.healthkit': true,
    });

    expect(bundleId.updateBundleIdCapabilityAsync).toBeCalledWith([
      { capabilityType: 'HEALTHKIT', option: 'ON' },
    ]);

    expect(results.enabled).toStrictEqual(['HealthKit']);
    expect(results.disabled).toStrictEqual([]);
  });

  it('disables some capabilities', async () => {
    const bundleId = {
      getBundleIdCapabilitiesAsync: jest.fn(() => [
        new BundleIdCapability({}, 'XXX_HOMEKIT', { settings: null }),
      ]),
      updateBundleIdCapabilityAsync: jest.fn(),
      id: 'XXX',
    } as any;

    const results = await syncCapabilitiesForEntitlementsAsync(bundleId, {
      'com.apple.developer.healthkit': true,
    });

    expect(bundleId.updateBundleIdCapabilityAsync).toBeCalledWith([
      { capabilityType: 'HEALTHKIT', option: 'ON' },
      { capabilityType: 'HOMEKIT', option: 'OFF' },
    ]);

    expect(results.enabled).toStrictEqual(['HealthKit']);
    expect(results.disabled).toStrictEqual(['HomeKit']);
  });

  // We don't disable APNS, IAP, or GC
  it('does not disable special capabilities', async () => {
    const bundleId = {
      getBundleIdCapabilitiesAsync: jest.fn(() => [
        new BundleIdCapability({}, 'XXX_IN_APP_PURCHASE', { settings: null }),
        new BundleIdCapability({}, 'XXX_GAME_CENTER', { settings: null }),
      ]),
      updateBundleIdCapabilityAsync: jest.fn(),
      id: 'XXX',
    } as any;

    const results = await syncCapabilitiesForEntitlementsAsync(bundleId, {});

    expect(bundleId.updateBundleIdCapabilityAsync).not.toBeCalled();

    expect(results.enabled).toStrictEqual([]);
    expect(results.disabled).toStrictEqual([]);
  });
  // Only disable known capabilities
  it('does not disable unhandled capabilities', async () => {
    const bundleId = {
      getBundleIdCapabilitiesAsync: jest.fn(() => [
        new BundleIdCapability({}, 'XXX_UNKNOWN_NEW_THING', { settings: null }),
      ]),
      updateBundleIdCapabilityAsync: jest.fn(),
      id: 'XXX',
    } as any;

    const results = await syncCapabilitiesForEntitlementsAsync(bundleId, {
      'com.apple.developer.healthkit': true,
    });

    expect(bundleId.updateBundleIdCapabilityAsync).toBeCalledWith([
      { capabilityType: 'HEALTHKIT', option: 'ON' },
    ]);

    expect(results.enabled).toStrictEqual(['HealthKit']);
    expect(results.disabled).toStrictEqual([]);
  });
});
