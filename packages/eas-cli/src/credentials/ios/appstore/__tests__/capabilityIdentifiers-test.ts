import { syncCapabilityIdentifiersForEntitlementsAsync } from '../capabilityIdentifiers';

function mockCapabilities(Apple: any): void {
  Apple.MerchantId.getAsync = jest.fn(() => [
    {
      id: 'XXX-merch-1',
      attributes: {
        identifier: 'merchant.expo',
      },
    },
  ]);

  Apple.MerchantId.createAsync = jest.fn((_ctx, { identifier }) => ({
    id: 'XXX-merch-2',
    attributes: {
      identifier,
    },
  }));

  Apple.AppGroup.getAsync = jest.fn(() => [
    {
      id: 'XXX-group-1',
      attributes: {
        identifier: 'group.expo',
      },
    },
  ]);
  Apple.AppGroup.createAsync = jest.fn((_ctx, { identifier }) => ({
    id: 'XXX-group-2',
    attributes: {
      identifier,
    },
  }));

  Apple.CloudContainer.getAsync = jest.fn(() => [
    {
      id: 'XXX-icloud-1',
      attributes: {
        identifier: 'iCloud.expo',
      },
    },
  ]);

  Apple.CloudContainer.createAsync = jest.fn((_ctx, { identifier }) => ({
    id: 'XXX-icloud-2',
    attributes: {
      identifier,
    },
  }));
}

describe(syncCapabilityIdentifiersForEntitlementsAsync, () => {
  it(`creates missing capability identifiers`, async () => {
    const Apple = require('@expo/apple-utils');
    mockCapabilities(Apple);

    const bundleId = {
      context: {},
      updateBundleIdCapabilityAsync: jest.fn(),
      id: 'XXX',
    } as any;

    await syncCapabilityIdentifiersForEntitlementsAsync(bundleId, {
      'com.apple.developer.in-app-payments': ['merchant.bacon'],
      'com.apple.security.application-groups': ['group.bacon'],
      'com.apple.developer.icloud-container-identifiers': ['iCloud.bacon'],
    });

    // Ensure we create missing ids
    expect(Apple.MerchantId.createAsync).toHaveBeenLastCalledWith(
      // auth context
      {},
      // props
      { identifier: 'merchant.bacon' }
    );
    // Ensure we create missing ids
    expect(Apple.AppGroup.createAsync).toHaveBeenLastCalledWith(
      // auth context
      {},
      // props
      { identifier: 'group.bacon' }
    );
    // Ensure we create missing ids
    expect(Apple.CloudContainer.createAsync).toHaveBeenLastCalledWith(
      // auth context
      {},
      // props
      { identifier: 'iCloud.bacon' }
    );

    expect(bundleId.updateBundleIdCapabilityAsync).toBeCalledWith([
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
  });

  it(`removes local duplicates`, async () => {
    const Apple = require('@expo/apple-utils');
    mockCapabilities(Apple);
    const bundleId = {
      context: {},
      updateBundleIdCapabilityAsync: jest.fn(),
      id: 'XXX',
    } as any;

    await syncCapabilityIdentifiersForEntitlementsAsync(bundleId, {
      'com.apple.developer.in-app-payments': ['merchant.expo', 'merchant.expo'],
    });

    // Only called once because we remove local duplicates to minimize network requests.
    expect(Apple.MerchantId.getAsync).toBeCalledTimes(1);
  });

  it(`creates missing capability identifiers`, async () => {
    const Apple = require('@expo/apple-utils');
    mockCapabilities(Apple);
    const bundleId = {
      context: {},
      updateBundleIdCapabilityAsync: jest.fn(),
      id: 'XXX',
    } as any;

    await syncCapabilityIdentifiersForEntitlementsAsync(bundleId, {
      'com.apple.developer.in-app-payments': ['merchant.expo'],
    });

    expect(Apple.MerchantId.createAsync).not.toBeCalled();
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
