import { BundleId, Profile, ProfileState, RequestContext } from '@expo/apple-utils';

async function getProfilesForBundleIdDangerousAsync(
  context: RequestContext,
  bundleIdentifier: string
): Promise<Profile[]> {
  const bundleId = await BundleId.findAsync(context, { identifier: bundleIdentifier });
  if (bundleId) {
    return await bundleId.getProfilesAsync();
  }
  return [];
}

export async function getProfilesForBundleIdAsync(
  context: RequestContext,
  bundleIdentifier: string
): Promise<Profile[]> {
  // Only work with active provisioning profiles, we can't use expired or invalid profiles
  // Once a profile expired or is marked as invalid, it cannot change back to active, making cache poisoning irrelevant here
  const profiles = await getProfilesForBundleIdDangerousAsync(context, bundleIdentifier).then(
    profiles => profiles.filter(profile => profile.attributes.profileState === ProfileState.ACTIVE)
  );

  // users sometimes have a poisoned Apple cache and receive stale data from the API
  // we call an arbitrary method, `getBundleIdAsync` on each profile
  // if it errors, the profile was stale, so we remove it
  const validProfileIds = new Set();
  await Promise.all(
    profiles.map(async profile => {
      try {
        await profile.getBundleIdAsync();
        validProfileIds.add(profile.id);
      } catch (e: any) {
        if (
          e.name === 'UnexpectedAppleResponse' &&
          e.message.includes('The specified resource does not exist - There is no resource of type')
        ) {
          // TODO: add tracking analytics here
          return;
        }
        throw e;
      }
    })
  );
  return profiles.filter(profile => validProfileIds.has(profile.id));
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
