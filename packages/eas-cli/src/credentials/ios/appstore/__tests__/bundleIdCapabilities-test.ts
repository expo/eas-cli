import { BundleIdCapability } from '@expo/apple-utils';

import { assertValidOptions, syncCapabilitiesForEntitlementsAsync } from '../bundleIdCapabilities';
import { CapabilityMapping } from '../capabilityList';

const noBroadcastNotificationOption = {
  usesBroadcastPushNotifications: false,
};

// Helper function to create reusable bundleId objects for testing
function createMockBundleId(id: string = 'XXX', capabilities: BundleIdCapability[] = []): any {
  return {
    getBundleIdCapabilitiesAsync: jest.fn(() => capabilities),
    updateBundleIdCapabilityAsync: jest.fn(),
    id,
  } as any;
}

describe(assertValidOptions, () => {
  it(`adds a reason for asserting capability identifiers`, () => {
    const classifier = CapabilityMapping.find(
      ({ capabilityIdPrefix }) => capabilityIdPrefix === 'merchant.'
    )!;
    expect(() => {
      assertValidOptions(classifier, ['foobar']);
    }).toThrow(/Expected an array of strings, where each string is prefixed with "merchant."/);
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

    const bundleId = createMockBundleId('U78L9459DG', capabilities);

    const { enabled, disabled } = await syncCapabilitiesForEntitlementsAsync(
      bundleId,
      entitlements,
      noBroadcastNotificationOption
    );

    expect(enabled).toStrictEqual(['Associated Domains']);
    expect(disabled).toStrictEqual([]);
    expect(bundleId.updateBundleIdCapabilityAsync).toHaveBeenCalledWith([
      {
        capabilityType: 'ASSOCIATED_DOMAINS',
        option: 'ON',
      },
    ]);
  });
  describe('capabilities with settings', () => {
    const ctx = { providerId: 123195, teamId: 'MyteamId' };
    const capabilities = [
      {
        id: 'U78L9459DG_APPLE_ID_AUTH',
        attributes: {
          ownerType: 'BUNDLE',
          settings: [
            {
              key: 'APPLE_ID_AUTH_APP_CONSENT',
              options: [
                {
                  key: 'PRIMARY_APP_CONSENT',
                  inputs: [
                    {
                      key: 'SERVER_TO_SERVER_NOTIF_URL',
                      name: 'Server to Server Notification URL',
                      description: 'Server to Server Notification URL',
                      allowedInstances: 'SINGLE',
                      minInstances: 0,
                      displayOrder: 0,
                      maxLimit: 1,
                      values: [
                        {
                          value: 'https://example.com/path/to/endpoint',
                        },
                      ],
                    },
                  ],
                  properties: [null],
                },
              ],
            },
          ],
          editable: true,
          inputs: null,
          enabled: true,
          responseId: '570fdbea-7996-4ace-8397-e318973d2f36',
        },
      },
      {
        id: 'U78L9459DG_ICLOUD',
        attributes: {
          ownerType: 'BUNDLE',
          settings: [
            {
              key: 'ICLOUD_VERSION',
              options: [
                {
                  key: 'XCODE_6',
                },
              ],
            },
          ],
          editable: true,
          inputs: null,
          enabled: true,
          responseId: '570fdbea-7996-4ace-8397-e318973d2f36',
        },
      },
      {
        id: 'U78L9459DG_DATA_PROTECTION',
        attributes: {
          ownerType: 'BUNDLE',
          settings: [
            {
              key: 'DATA_PROTECTION_PERMISSION_LEVEL',
              options: [
                {
                  key: 'COMPLETE_PROTECTION',
                },
              ],
            },
          ],
          editable: true,
          inputs: null,
          enabled: true,
          responseId: '570fdbea-7996-4ace-8397-e318973d2f36',
        },
      },
    ].map(({ id, attributes }) => new BundleIdCapability(ctx, id, attributes as any));

    const entitlements = {
      'com.apple.developer.applesignin': ['Default'],
      'com.apple.developer.default-data-protection': 'NSFileProtectionComplete',
      'com.apple.developer.icloud-container-identifiers': ['iCloud.com.vonovak.edfapp'],
      'com.apple.developer.icloud-services': ['CloudDocuments'],
      'com.apple.developer.ubiquity-container-identifiers': ['iCloud.com.vonovak.edfapp'],
      'com.apple.developer.ubiquity-kvstore-identifier':
        '$(TeamIdentifierPrefix)com.vonovak.edfapp',
    };

    it('does not sync a capability that is already enabled', async () => {
      const bundleId = createMockBundleId('U78L9459DG', capabilities);
      const result = await syncCapabilitiesForEntitlementsAsync(
        bundleId,
        entitlements,
        noBroadcastNotificationOption
      );

      expect(result).toStrictEqual({
        enabled: [],
        disabled: [],
      });
      expect(bundleId.updateBundleIdCapabilityAsync).not.toHaveBeenCalled();
    });

    it('enables capabilities when they are not present', async () => {
      const bundleId = createMockBundleId('U78L9459DG', []);
      const { enabled, disabled } = await syncCapabilitiesForEntitlementsAsync(
        bundleId,
        entitlements,
        noBroadcastNotificationOption
      );

      expect(bundleId.updateBundleIdCapabilityAsync).toHaveBeenCalledWith([
        { capabilityType: 'APPLE_ID_AUTH', option: 'ON' },
        { capabilityType: 'DATA_PROTECTION', option: 'COMPLETE_PROTECTION' },
        { capabilityType: 'ICLOUD', option: 'ON' },
      ]);
      expect(enabled).toStrictEqual(['Sign In with Apple', 'Data Protection', 'iCloud']);
      expect(disabled).toStrictEqual([]);
    });

    it('disables capabilities when no entitlements are provided', async () => {
      const bundleId = createMockBundleId('U78L9459DG', capabilities);
      const { enabled, disabled } = await syncCapabilitiesForEntitlementsAsync(
        bundleId,
        {}, // no entitlements
        noBroadcastNotificationOption
      );

      expect(bundleId.updateBundleIdCapabilityAsync).toHaveBeenCalledWith([
        { capabilityType: 'APPLE_ID_AUTH', option: 'OFF' },
        { capabilityType: 'ICLOUD', option: 'OFF' },
        { capabilityType: 'DATA_PROTECTION', option: 'OFF' },
      ]);
      expect(enabled).toStrictEqual([]);
      expect(disabled).toStrictEqual(['Sign In with Apple', 'iCloud', 'Data Protection']);
    });
  });

  describe('boolean capabilities: given a bundleId with no capabilities', () => {
    it('enables boolean capability when set to true', async () => {
      const bundleId = createMockBundleId();
      const result = await syncCapabilitiesForEntitlementsAsync(
        bundleId,
        {
          'com.apple.developer.networking.wifi-info': true,
        },
        noBroadcastNotificationOption
      );

      expect(bundleId.updateBundleIdCapabilityAsync).toHaveBeenCalledWith([
        { capabilityType: 'ACCESS_WIFI_INFORMATION', option: 'ON' },
      ]);
      expect(result).toStrictEqual({
        enabled: ['Access WiFi Information'],
        disabled: [],
      });
    });

    it('does not enable a capability when it is set to false', async () => {
      const bundleId = createMockBundleId();
      const result = await syncCapabilitiesForEntitlementsAsync(
        bundleId,
        {
          'com.apple.developer.networking.wifi-info': false,
        },
        noBroadcastNotificationOption
      );

      expect(bundleId.updateBundleIdCapabilityAsync).not.toHaveBeenCalled();
      expect(result).toStrictEqual({
        enabled: [],
        disabled: [],
      });
    });

    describe('given a bundleId with a capability that is enabled', () => {
      const ctx = { providerId: 123195, teamId: 'MyteamId' };
      const remote = {
        id: 'UFJ54VZ75A_ACCESS_WIFI_INFORMATION',
        attributes: {
          ownerType: 'BUNDLE',
          settings: null,
          editable: true,
          inputs: null,
          enabled: true,
          responseId: '31746b7d-4728-49f5-a8f9-a81c0cecabb1',
        },
      };
      const capability = new BundleIdCapability(ctx, remote.id, remote.attributes as any);

      it('and the entitlement is set to false, the capability is disabled', async () => {
        const bundleId = createMockBundleId('UFJ54VZ75A', [capability]);
        const { enabled, disabled } = await syncCapabilitiesForEntitlementsAsync(
          bundleId,
          {
            'com.apple.developer.networking.wifi-info': false,
          },
          noBroadcastNotificationOption
        );

        expect(enabled).toStrictEqual([]);
        expect(disabled).toStrictEqual(['Access WiFi Information']);
        expect(bundleId.updateBundleIdCapabilityAsync).toHaveBeenCalledWith([
          { capabilityType: 'ACCESS_WIFI_INFORMATION', option: 'OFF' },
        ]);
      });

      it('and the entitlement is set to true, the capability is skipped', async () => {
        const bundleId = createMockBundleId('UFJ54VZ75A', [capability]);
        const { enabled, disabled } = await syncCapabilitiesForEntitlementsAsync(
          bundleId,
          {
            'com.apple.developer.networking.wifi-info': true,
          },
          noBroadcastNotificationOption
        );

        expect(enabled).toStrictEqual([]);
        expect(disabled).toStrictEqual([]);
        expect(bundleId.updateBundleIdCapabilityAsync).not.toHaveBeenCalled();
      });
    });
  });

  it('enables all capabilities', async () => {
    const bundleId = createMockBundleId();

    const results = await syncCapabilitiesForEntitlementsAsync(
      bundleId,
      {
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
        'aps-environment': 'production',
      },
      noBroadcastNotificationOption
    );

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
      {
        capabilityType: 'PUSH_NOTIFICATIONS',
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
        "Push Notifications",
      ]
    `);
    expect(results.disabled).toStrictEqual([]);
  });

  it('skips simple duplicates', async () => {
    const bundleId = createMockBundleId('XXX', [
      new BundleIdCapability({}, 'XXX_HEALTHKIT', { settings: null }),
    ]);

    const results = await syncCapabilitiesForEntitlementsAsync(
      bundleId,
      {
        'com.apple.developer.healthkit': true,
      },
      noBroadcastNotificationOption
    );

    expect(bundleId.updateBundleIdCapabilityAsync).not.toHaveBeenCalled();

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
      syncCapabilitiesForEntitlementsAsync(
        bundleId,
        {
          'com.apple.developer.healthkit': true,
        },
        noBroadcastNotificationOption
      )
    ).rejects.toThrowError(
      `https://developer-mdn.apple.com/account/resources/identifiers/bundleId/edit/XXX333`
    );
  });

  it('cannot skip complex duplicates', async () => {
    const bundleId = createMockBundleId('XXX', [
      new BundleIdCapability({}, 'XXX_HEALTHKIT', { settings: [] }),
    ]);

    const results = await syncCapabilitiesForEntitlementsAsync(
      bundleId,
      {
        'com.apple.developer.healthkit': true,
      },
      noBroadcastNotificationOption
    );

    expect(bundleId.updateBundleIdCapabilityAsync).toHaveBeenCalledWith([
      { capabilityType: 'HEALTHKIT', option: 'ON' },
    ]);

    expect(results.enabled).toStrictEqual(['HealthKit']);
    expect(results.disabled).toStrictEqual([]);
  });

  it('disables some capabilities', async () => {
    const bundleId = createMockBundleId('XXX', [
      new BundleIdCapability({}, 'XXX_HOMEKIT', { settings: null }),
    ]);

    const results = await syncCapabilitiesForEntitlementsAsync(
      bundleId,
      {
        'com.apple.developer.healthkit': true,
      },
      noBroadcastNotificationOption
    );

    expect(bundleId.updateBundleIdCapabilityAsync).toHaveBeenCalledWith([
      { capabilityType: 'HEALTHKIT', option: 'ON' },
      { capabilityType: 'HOMEKIT', option: 'OFF' },
    ]);

    expect(results.enabled).toStrictEqual(['HealthKit']);
    expect(results.disabled).toStrictEqual(['HomeKit']);
  });

  // We don't disable APNS, IAP, or GC
  it('does not disable special capabilities', async () => {
    const bundleId = createMockBundleId('XXX', [
      new BundleIdCapability({}, 'XXX_IN_APP_PURCHASE', { settings: null }),
      new BundleIdCapability({}, 'XXX_GAME_CENTER', { settings: null }),
    ]);

    const results = await syncCapabilitiesForEntitlementsAsync(
      bundleId,
      {},
      noBroadcastNotificationOption
    );

    expect(bundleId.updateBundleIdCapabilityAsync).not.toHaveBeenCalledWith();

    expect(results.enabled).toStrictEqual([]);
    expect(results.disabled).toStrictEqual([]);
  });
  // Only disable known capabilities
  it('does not disable unhandled capabilities', async () => {
    const bundleId = createMockBundleId('XXX', [
      new BundleIdCapability({}, 'XXX_UNKNOWN_NEW_THING', { settings: null }),
    ]);

    const results = await syncCapabilitiesForEntitlementsAsync(
      bundleId,
      {
        'com.apple.developer.healthkit': true,
      },
      noBroadcastNotificationOption
    );

    expect(bundleId.updateBundleIdCapabilityAsync).toBeCalledWith([
      { capabilityType: 'HEALTHKIT', option: 'ON' },
    ]);

    expect(results.enabled).toStrictEqual(['HealthKit']);
    expect(results.disabled).toStrictEqual([]);
  });

  it('enables push notifications capability with broadcast option when the capability is disabled and usesBroadcastPushNotifications is true', async () => {
    const bundleId = createMockBundleId();

    const results = await syncCapabilitiesForEntitlementsAsync(
      bundleId,
      {
        'aps-environment': 'production',
      },
      {
        usesBroadcastPushNotifications: true,
      }
    );

    expect(bundleId.updateBundleIdCapabilityAsync).toHaveBeenCalledWith([
      { capabilityType: 'PUSH_NOTIFICATIONS', option: 'PUSH_NOTIFICATION_FEATURE_BROADCAST' },
    ]);

    expect(results.enabled).toStrictEqual(['Push Notifications']);
    expect(results.disabled).toStrictEqual([]);
  });

  it('updates push notifications capability with broadcast option when the capability is enabled without settings and usesBroadcastPushNotifications is true', async () => {
    const bundleId = createMockBundleId('XXX', [
      new BundleIdCapability({}, 'XXX_PUSH_NOTIFICATIONS', { settings: null }),
    ]);

    const results = await syncCapabilitiesForEntitlementsAsync(
      bundleId,
      {
        'aps-environment': 'production',
      },
      {
        usesBroadcastPushNotifications: true,
      }
    );

    expect(bundleId.updateBundleIdCapabilityAsync).toHaveBeenCalledWith([
      { capabilityType: 'PUSH_NOTIFICATIONS', option: 'PUSH_NOTIFICATION_FEATURE_BROADCAST' },
    ]);

    expect(results.enabled).toStrictEqual(['Push Notifications']);
    expect(results.disabled).toStrictEqual([]);
  });

  it('disables push notifications capability', async () => {
    const bundleId = createMockBundleId('XXX', [
      new BundleIdCapability({}, 'XXX_PUSH_NOTIFICATIONS', { settings: null }),
    ]);

    const results = await syncCapabilitiesForEntitlementsAsync(
      bundleId,
      {},
      {
        usesBroadcastPushNotifications: true,
      }
    );

    expect(bundleId.updateBundleIdCapabilityAsync).toHaveBeenCalledWith([
      { capabilityType: 'PUSH_NOTIFICATIONS', option: 'OFF' },
    ]);

    expect(results.disabled).toStrictEqual(['Push Notifications']);
    expect(results.enabled).toStrictEqual([]);
  });

  it('does nothing when push notifications capability is enabled with broadcast options and usesBroadcastPushNotifications is true', async () => {
    const bundleId = createMockBundleId('XXX', [
      new BundleIdCapability({}, 'XXX_PUSH_NOTIFICATIONS', {
        settings: [],
      }),
    ]);

    const results = await syncCapabilitiesForEntitlementsAsync(
      bundleId,
      {
        'aps-environment': 'production',
      },
      {
        usesBroadcastPushNotifications: true,
      }
    );

    expect(bundleId.updateBundleIdCapabilityAsync).not.toBeCalled();

    expect(results.disabled).toStrictEqual([]);
    expect(results.enabled).toStrictEqual([]);
  });

  it('does nothing when push notifications capability is enabled without broadcast options and usesBroadcastPushNotifications is false', async () => {
    const bundleId = createMockBundleId('XXX', [
      new BundleIdCapability({}, 'XXX_PUSH_NOTIFICATIONS', {
        settings: null,
      }),
    ]);

    const results = await syncCapabilitiesForEntitlementsAsync(
      bundleId,
      {
        'aps-environment': 'production',
      },
      noBroadcastNotificationOption
    );

    expect(bundleId.updateBundleIdCapabilityAsync).not.toBeCalled();

    expect(results.disabled).toStrictEqual([]);
    expect(results.enabled).toStrictEqual([]);
  });

  it('updates push notifications capability without broadcast options when it is enabled and usesBroadcastPushNotifications is false', async () => {
    const bundleId = createMockBundleId('XXX', [
      new BundleIdCapability({}, 'XXX_PUSH_NOTIFICATIONS', {
        settings: [],
      }),
    ]);

    const results = await syncCapabilitiesForEntitlementsAsync(
      bundleId,
      {
        'aps-environment': 'production',
      },
      noBroadcastNotificationOption
    );

    expect(bundleId.updateBundleIdCapabilityAsync).toHaveBeenCalledWith([
      { capabilityType: 'PUSH_NOTIFICATIONS', option: 'ON' },
    ]);

    expect(results.disabled).toStrictEqual([]);
    expect(results.enabled).toStrictEqual(['Push Notifications']);
  });
});
