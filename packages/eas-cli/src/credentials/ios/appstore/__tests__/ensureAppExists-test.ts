import { syncCapabilities } from '../ensureAppExists';

describe(syncCapabilities, () => {
  test("bundleId.updateBundleIdCapabilityAsync should not be called if there's noting to update", async () => {
    const bundleId = {
      hasCapabilityAsync: jest.fn().mockImplementation(() => {
        return {};
      }),
      updateBundleIdCapabilityAsync: jest.fn(),
    } as any;
    await syncCapabilities(bundleId, { enablePushNotifications: true });
    expect(bundleId.updateBundleIdCapabilityAsync).not.toHaveBeenCalled();
  });
  test('bundleId.updateBundleIdCapabilityAsync should be called if there are some changes to be made', async () => {
    const bundleId = {
      hasCapabilityAsync: jest.fn().mockImplementation(() => {
        return null;
      }),
      updateBundleIdCapabilityAsync: jest.fn(),
    } as any;
    await syncCapabilities(bundleId, { enablePushNotifications: true });
    expect(bundleId.updateBundleIdCapabilityAsync).toHaveBeenCalled();
  });
});
