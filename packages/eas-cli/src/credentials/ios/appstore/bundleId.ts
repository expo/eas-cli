import { BundleId, Profile, ProfileType, RequestContext } from '@expo/apple-utils';

export async function getProfilesForBundleIdAsync(
  context: RequestContext,
  bundleIdentifier: string,
  profileType?: ProfileType
): Promise<Profile[]> {
  const allProfiles = await Profile.getAsync(context, {
    query: { filter: { profileType }, includes: ['devices', 'bundleId', 'certificates'] },
  });
  return allProfiles.filter(
    profile => profile.attributes.bundleId?.attributes.identifier === bundleIdentifier
  );
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
