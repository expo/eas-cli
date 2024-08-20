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
    expect(() => {
      assertValidOptions(classifier, ['foobar']);
    }).toThrowError(/Expected an array of strings, where each string is prefixed with "merchant."/);
  });
});

describe(syncCapabilitiesForEntitlementsAsync, () => {
  it(`does not disable associated domains when MDM managed domains is active`, async () => {
    const ctx = { providerId: 123195, teamId: 'MyteamId' };
    // https://forums.expo.dev/t/eas-build-failed-on-ios-associated-domains-capability/61662/5
    const capabilities = [
      {
        id: 'U78L9459DG_MDM_MANAGED_ASSOCIATED_DOMAINS',
        attributes: {
          ownerType: 'BUNDLE',
          settings: null,
          editable: true,
          inputs: null,
          enabled: true,
          responseId: '77eb74ad-7c24-48de-9d35-1fabb4c5afd9',
        },
      },
    ].map(({ id, attributes }) => new BundleIdCapability(ctx, id, attributes as any));

    const entitlements = {
      'com.apple.developer.associated-domains': ['applinks:packagename.fr'],
    };

    const bundleId = {
      getBundleIdCapabilitiesAsync: jest.fn(() => capabilities),
      updateBundleIdCapabilityAsync: jest.fn(),
      id: 'XXX',
    } as any;

    await syncCapabilitiesForEntitlementsAsync(bundleId, entitlements);

    expect(bundleId.updateBundleIdCapabilityAsync).toBeCalledWith([
      {
        capabilityType: 'ASSOCIATED_DOMAINS',
        option: 'ON',
      },
    ]);
  });

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

      'com.apple.developer.fileprovider.testing-mode': true,
      'com.apple.developer.healthkit.recalibrate-estimates': true,
      'com.apple.developer.maps': true,
      'com.apple.developer.user-management': true,
      'com.apple.developer.networking.custom-protocol': true,
      'com.apple.developer.system-extension.install': true,
      'com.apple.developer.push-to-talk': true,
      'com.apple.developer.driverkit.transport.usb': true,
      'com.apple.developer.kernel.increased-memory-limit': true,
      'com.apple.developer.driverkit.communicates-with-drivers': true,
      'com.apple.developer.media-device-discovery-extension': true,
      'com.apple.developer.driverkit.allow-third-party-userclients': true,
      'com.apple.developer.weatherkit': true,
      'com.apple.developer.on-demand-install-capable': true,
      'com.apple.developer.driverkit.family.scsicontroller': true,
      'com.apple.developer.driverkit.family.serial': true,
      'com.apple.developer.driverkit.family.networking': true,
      'com.apple.developer.driverkit.family.hid.eventservice': true,
      'com.apple.developer.driverkit.family.hid.device': true,
      'com.apple.developer.driverkit': true,
      'com.apple.developer.driverkit.transport.hid': true,
      'com.apple.developer.driverkit.family.audio': true,
      'com.apple.developer.shared-with-you': true,
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
      {
        capabilityType: 'FILEPROVIDER_TESTINGMODE',
        option: 'ON',
      },
      {
        capabilityType: 'HEALTHKIT_RECALIBRATE_ESTIMATES',
        option: 'ON',
      },
      {
        capabilityType: 'MAPS',
        option: 'ON',
      },
      {
        capabilityType: 'USER_MANAGEMENT',
        option: 'ON',
      },
      {
        capabilityType: 'NETWORK_CUSTOM_PROTOCOL',
        option: 'ON',
      },
      {
        capabilityType: 'SYSTEM_EXTENSION_INSTALL',
        option: 'ON',
      },
      {
        capabilityType: 'PUSH_TO_TALK',
        option: 'ON',
      },
      {
        capabilityType: 'DRIVERKIT_USBTRANSPORT_PUB',
        option: 'ON',
      },
      {
        capabilityType: 'INCREASED_MEMORY_LIMIT',
        option: 'ON',
      },
      {
        capabilityType: 'DRIVERKIT_COMMUNICATESWITHDRIVERS',
        option: 'ON',
      },
      {
        capabilityType: 'MEDIA_DEVICE_DISCOVERY',
        option: 'ON',
      },
      {
        capabilityType: 'DRIVERKIT_ALLOWTHIRDPARTY_USERCLIENTS',
        option: 'ON',
      },
      {
        capabilityType: 'WEATHERKIT',
        option: 'ON',
      },
      {
        capabilityType: 'ONDEMANDINSTALL_EXTENSIONS',
        option: 'ON',
      },
      {
        capabilityType: 'DRIVERKIT_FAMILY_SCSICONTROLLER_PUB',
        option: 'ON',
      },
      {
        capabilityType: 'DRIVERKIT_FAMILY_SERIAL_PUB',
        option: 'ON',
      },
      {
        capabilityType: 'DRIVERKIT_FAMILY_NETWORKING_PUB',
        option: 'ON',
      },
      {
        capabilityType: 'DRIVERKIT_FAMILY_HIDEVENTSERVICE_PUB',
        option: 'ON',
      },
      {
        capabilityType: 'DRIVERKIT_FAMILY_HIDDEVICE_PUB',
        option: 'ON',
      },
      {
        capabilityType: 'DRIVERKIT_PUBLIC',
        option: 'ON',
      },
      {
        capabilityType: 'DRIVERKIT_TRANSPORT_HID_PUB',
        option: 'ON',
      },
      {
        capabilityType: 'DRIVERKIT_FAMILY_AUDIO_PUB',
        option: 'ON',
      },
      {
        capabilityType: 'SHARED_WITH_YOU',
        option: 'ON',
      },
    ]);

    expect(results.enabled).toMatchInlineSnapshot(`
      [
        "HealthKit",
        "Apple Pay Payment Processing",
        "iCloud",
        "ClassKit",
        "Data Protection",
        "Network Extensions",
        "Personal VPN",
        "Hotspot",
        "Extended Virtual Address Space",
        "HomeKit",
        "Multipath",
        "Wireless Accessory Configuration",
        "Inter-App Audio",
        "Wallet",
        "Fonts",
        "App Attest",
        "NFC Tag Reading",
        "Sign In with Apple",
        "SiriKit",
        "Access WiFi Information",
        "Communication Notifications",
        "Time Sensitive Notifications",
        "Group Activities",
        "Family Controls",
        "AutoFill Credential Provider",
        "App Groups",
        "FileProvider TestingMode",
        "Recalibrate Estimates",
        "Maps",
        "TV Services",
        "Custom Network Protocol",
        "System Extension",
        "Push to Talk",
        "DriverKit USB Transport (development)",
        "Increased Memory Limit",
        "Communicates with Drivers",
        "Media Device Discovery",
        "DriverKit Allow Third Party UserClients",
        "WeatherKit",
        "On Demand Install Capable for App Clip Extensions",
        "DriverKit Family SCSIController (development)",
        "DriverKit Family Serial (development)",
        "DriverKit Family Networking (development)",
        "DriverKit Family HID EventService (development)",
        "DriverKit Family HID Device (development)",
        "DriverKit for Development",
        "DriverKit Transport HID (development)",
        "DriverKit Family Audio (development)",
        "Shared with You",
      ]
    `);
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
      `https://developer-mdn.apple.com/account/resources/identifiers/bundleId/edit/XXX333`
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
