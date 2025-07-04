import { syncCapabilityIdentifiersForEntitlementsAsync } from '../capabilityIdentifiers';

const mockItems = {
  merchant: {
    expo: { id: 'XXX-merch-1', attributes: { identifier: 'merchant.expo' } },
  },
  appGroup: {
    expo: { id: 'XXX-group-1', attributes: { identifier: 'group.expo' } },
  },
  cloudContainer: {
    expo: { id: 'XXX-icloud-1', attributes: { identifier: 'iCloud.expo' } },
  },
};

function mockCapabilities(Apple: any): void {
  const mockGetAsync = (existingItems: any[]): jest.Mock =>
    jest.fn(() => Promise.resolve(existingItems));

  const mockCreateAsync = (newId: string): jest.Mock =>
    jest.fn((_ctx, { identifier }) => ({
      id: newId,
      attributes: {
        identifier,
      },
    }));

  Apple.MerchantId.getAsync = mockGetAsync([mockItems.merchant.expo]);

  Apple.MerchantId.createAsync = mockCreateAsync('XXX-merch-2');

  Apple.AppGroup.getAsync = mockGetAsync([mockItems.appGroup.expo]);

  Apple.AppGroup.createAsync = mockCreateAsync('XXX-group-2');

  Apple.CloudContainer.getAsync = mockGetAsync([mockItems.cloudContainer.expo]);

  Apple.CloudContainer.createAsync = mockCreateAsync('XXX-icloud-2');
}

function mockCapabilitiesAlreadyCreated(Apple: any): void {
  Apple.MerchantId.getAsync.mockResolvedValue([
    mockItems.merchant.expo,
    { id: 'XXX-merch-2', attributes: { identifier: 'merchant.bacon' } },
  ]);

  Apple.AppGroup.getAsync.mockResolvedValue([
    mockItems.appGroup.expo,
    { id: 'XXX-group-2', attributes: { identifier: 'group.bacon' } },
  ]);

  Apple.CloudContainer.getAsync.mockResolvedValue([
    mockItems.cloudContainer.expo,
    { id: 'XXX-icloud-2', attributes: { identifier: 'iCloud.bacon' } },
  ]);
}

describe(syncCapabilityIdentifiersForEntitlementsAsync, () => {
  it(`creates missing capability identifiers, and once they are created, they are not re-created`, async () => {
    const Apple = require('@expo/apple-utils');
    mockCapabilities(Apple);

    const bundleId = {
      context: {},
      updateBundleIdCapabilityAsync: jest.fn(),
      id: 'XXX',
    } as any;

    const syncCapabilities = (): Promise<{
      created: string[];
      linked: string[];
    }> =>
      syncCapabilityIdentifiersForEntitlementsAsync(bundleId, {
        'com.apple.developer.in-app-payments': ['merchant.bacon'],
        'com.apple.security.application-groups': ['group.bacon'],
        'com.apple.developer.icloud-container-identifiers': ['iCloud.bacon'],
      });

    const result = await syncCapabilities();
    expect(result).toStrictEqual({
      created: ['group.bacon', 'merchant.bacon', 'iCloud.bacon'],
      linked: ['group.bacon', 'merchant.bacon', 'iCloud.bacon'],
    });
    mockCapabilitiesAlreadyCreated(Apple);
    const result2 = await syncCapabilities();
    expect(result2).toStrictEqual({
      created: [],
      linked: [],
    });

    // Ensure we create missing ids
    expect(Apple.MerchantId.createAsync).toHaveBeenLastCalledWith(
      // auth context
      {},
      // props
      { identifier: 'merchant.bacon' }
    );
    expect(Apple.MerchantId.createAsync).toHaveBeenCalledTimes(1);
    // Ensure we create missing ids
    expect(Apple.AppGroup.createAsync).toHaveBeenLastCalledWith(
      // auth context
      {},
      // props
      { identifier: 'group.bacon' }
    );
    expect(Apple.AppGroup.createAsync).toHaveBeenCalledTimes(1);
    // Ensure we create missing ids
    expect(Apple.CloudContainer.createAsync).toHaveBeenLastCalledWith(
      // auth context
      {},
      // props
      { identifier: 'iCloud.bacon' }
    );
    expect(Apple.CloudContainer.createAsync).toHaveBeenCalledTimes(1);
    expect(bundleId.updateBundleIdCapabilityAsync).toHaveBeenLastCalledWith([
      {
        capabilityType: 'APP_GROUPS',
        option: 'ON',
        relationships: {
          appGroups: ['XXX-group-2'],
        },
      },
      {
        capabilityType: 'APPLE_PAY',
        option: 'ON',
        relationships: {
          merchantIds: ['XXX-merch-2'],
        },
      },
      {
        capabilityType: 'ICLOUD',
        option: 'ON',
        relationships: {
          cloudContainers: ['XXX-icloud-2'],
        },
      },
    ]);
    expect(bundleId.updateBundleIdCapabilityAsync).toHaveBeenCalledTimes(1);
  });

  it(`doesn't perform duplicate CapabilityModel.getAsync calls`, async () => {
    const Apple = require('@expo/apple-utils');
    mockCapabilities(Apple);
    const bundleId = {
      context: {},
      updateBundleIdCapabilityAsync: jest.fn(),
      id: 'XXX',
    } as any;

    const result = await syncCapabilityIdentifiersForEntitlementsAsync(bundleId, {
      'com.apple.developer.in-app-payments': ['merchant.expo', 'merchant.expo'],
    });

    // Only called once because we remove local duplicates to minimize network requests.
    expect(Apple.MerchantId.getAsync).toHaveBeenCalledTimes(1);
    expect(bundleId.updateBundleIdCapabilityAsync).not.toHaveBeenCalled();
    expect(result).toStrictEqual({
      created: [],
      linked: [],
    });
  });

  it(`does not create capability identifiers (merchant.expo) when it already exists`, async () => {
    const Apple = require('@expo/apple-utils');
    mockCapabilities(Apple);
    const bundleId = {
      context: {},
      updateBundleIdCapabilityAsync: jest.fn(),
      id: 'XXX',
    };

    const result = await syncCapabilityIdentifiersForEntitlementsAsync(bundleId as any, {
      'com.apple.developer.in-app-payments': ['merchant.expo'],
    });

    expect(Apple.MerchantId.createAsync).not.toHaveBeenCalled();
    expect(bundleId.updateBundleIdCapabilityAsync).not.toHaveBeenCalled();
    expect(result).toStrictEqual({
      created: [],
      linked: [],
    });
  });

  it(`throws when creating a missing capability that is reserved`, async () => {
    const Apple = require('@expo/apple-utils');
    mockCapabilities(Apple);
    Apple.MerchantId.createAsync = jest.fn(
      (_ctx: any, { identifier }: { identifier: string }): any => {
        // e2e test with: merchant.expodemo
        throw new Error(
          `There is a problem with the request entity - A Merchant ID with Identifier '${identifier}' is not available. Enter a different string.`
        );
      }
    );
    const bundleId = {
      context: {},
      updateBundleIdCapabilityAsync: jest.fn(),
      id: 'XXX',
    } as any;

    await expect(
      syncCapabilityIdentifiersForEntitlementsAsync(bundleId, {
        'com.apple.developer.in-app-payments': ['merchant.bacon'],
      })
    ).rejects.toThrow(/is not available. Enter a different string/);
  });
});
