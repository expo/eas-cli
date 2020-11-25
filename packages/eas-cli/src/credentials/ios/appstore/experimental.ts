import { BundleId, Profile, RequestContext } from '@expo/apple-utils';
import { boolish } from 'getenv';

export const USE_APPLE_UTILS = boolish('USE_APPLE_UTILS', false);

export async function getProfilesForBundleIdAsync(
  context: RequestContext,
  bundleIdentifier: string
): Promise<Profile[]> {
  const [bundleId] = await BundleId.getAsync(context, {
    query: {
      filter: {
        identifier: bundleIdentifier,
      },
    },
  });
  if (bundleId) {
    return bundleId.getProfilesAsync();
  }
  return [];
}

export async function getBundleIdForIdentifierAsync(
  context: RequestContext,
  bundleIdentifier: string
): Promise<BundleId> {
  const bundleId = await BundleId.findAsync(context, { identifier: bundleIdentifier });
  if (!bundleId) {
    throw new Error(`Failed to find Bundle ID item with identifier "${bundleIdentifier}"`);
  }
  return bundleId;
}
