import AppleUtils, { type RequestContext } from '@expo/apple-utils';

const { BundleId } = AppleUtils;

async function getProfilesForBundleIdDangerousAsync(
  context: RequestContext,
  bundleIdentifier: string
): Promise<AppleUtils.Profile[]> {
  const bundleId = await BundleId.findAsync(context, { identifier: bundleIdentifier });
  if (bundleId) {
    return bundleId.getProfilesAsync();
  }
  return [];
}

export async function getProfilesForBundleIdAsync(
  context: RequestContext,
  bundleIdentifier: string
): Promise<AppleUtils.Profile[]> {
  const profiles = await getProfilesForBundleIdDangerousAsync(context, bundleIdentifier);
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
): Promise<AppleUtils.BundleId> {
  const bundleId = await BundleId.findAsync(context, { identifier: bundleIdentifier });
  if (!bundleId) {
    throw new Error(`Failed to find Bundle ID item with identifier "${bundleIdentifier}"`);
  }
  return bundleId;
}
