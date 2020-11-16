import { BundleId, Profile } from '@expo/apple-utils';

export async function getProfilesForBundleIdAsync(bundleIdentifier: string): Promise<Profile[]> {
  const bundleId = await BundleId.findAsync({ identifier: bundleIdentifier });
  if (bundleId) {
    return bundleId.getProfilesAsync();
  }
  return [];
}

export async function getBundleIdForIdentifierAsync(bundleIdentifier: string): Promise<BundleId> {
  const bundleId = await BundleId.findAsync({ identifier: bundleIdentifier });
  if (!bundleId) {
    throw new Error(`Failed to find Bundle ID item with identifier "${bundleIdentifier}"`);
  }
  return bundleId;
}
