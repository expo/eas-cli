import { Profile, ProfileType, RequestContext } from '@expo/apple-utils';

import {
  DistributionCertificate,
  ProvisioningProfile,
  ProvisioningProfileStoreInfo,
} from './Credentials.types';
import { getRequestContext } from './authenticate';
import { AuthCtx } from './authenticateTypes';
import { getBundleIdForIdentifierAsync, getProfilesForBundleIdAsync } from './bundleId';
import { ApplePlatform } from './constants';
import { getCertificateBySerialNumberAsync, transformCertificate } from './distributionCertificate';
import { ora } from '../../../ora';
import { isAppStoreConnectTokenOnlyContext } from '../utils/authType';
import { findP12CertSerialNumber } from '../utils/p12Certificate';

export enum ProfileClass {
  Adhoc = 'ad_hoc',
  General = 'general',
}

function resolveProfileType(
  applePlatform: ApplePlatform,
  profileClass: ProfileClass,
  isEnterprise?: boolean
): ProfileType {
  switch (applePlatform) {
    case ApplePlatform.IOS:
      return resolveProfileTypeIos(profileClass, isEnterprise);
    case ApplePlatform.TV_OS:
      return resolveProfileTypeAppleTv(profileClass, isEnterprise);
    case ApplePlatform.MAC_OS:
      throw new Error(`${applePlatform} profiles are not supported`);
  }
}

function resolveProfileTypeAppleTv(
  profileClass: ProfileClass,
  isEnterprise?: boolean
): ProfileType {
  if (isEnterprise) {
    return profileClass === ProfileClass.Adhoc
      ? ProfileType.TVOS_APP_ADHOC
      : ProfileType.TVOS_APP_INHOUSE;
  } else {
    return profileClass === ProfileClass.Adhoc
      ? ProfileType.TVOS_APP_ADHOC
      : ProfileType.TVOS_APP_STORE;
  }
}

function resolveProfileTypeIos(profileClass: ProfileClass, isEnterprise?: boolean): ProfileType {
  if (isEnterprise) {
    return profileClass === ProfileClass.Adhoc
      ? ProfileType.IOS_APP_ADHOC
      : ProfileType.IOS_APP_INHOUSE;
  } else {
    return profileClass === ProfileClass.Adhoc
      ? ProfileType.IOS_APP_ADHOC
      : ProfileType.IOS_APP_STORE;
  }
}

async function transformProfileAsync(
  cert: Profile,
  authCtx: AuthCtx
): Promise<ProvisioningProfileStoreInfo> {
  return {
    provisioningProfileId: cert.id,
    name: cert.attributes.name,
    status: cert.attributes.profileState,
    expires: new Date(cert.attributes.expirationDate).getTime() / 1000,
    distributionMethod: cert.attributes.profileType,
    // @ts-expect-error -- this can be null when the profile has expired.
    provisioningProfile: cert.attributes.profileContent,
    certificates: (await cert.getCertificatesAsync()).map(transformCertificate),
    teamId: authCtx.team.id,
    teamName: authCtx.team.name,
  };
}

async function addCertificateToProfileAsync(
  context: RequestContext,
  {
    serialNumber,
    profileId,
    bundleIdentifier,
  }: {
    serialNumber: string;
    profileId: string;
    bundleIdentifier: string;
  }
): Promise<Profile> {
  const cert = await getCertificateBySerialNumberAsync(context, serialNumber);

  const profiles = await getProfilesForBundleIdAsync(context, bundleIdentifier);
  const profile = profiles.find(profile => profile.id === profileId);
  if (!profile) {
    throw new Error(
      `Failed to find profile for bundle identifier "${bundleIdentifier}" with profile id "${profileId}"`
    );
  }

  // Assign the new certificate
  profile.attributes.certificates = [cert];

  // Experimentally regenerate the provisioning profile using App Store Connect API.
  if (isAppStoreConnectTokenOnlyContext(profile.context)) {
    return await profile.regenerateManuallyAsync();
  }
  // This method does not support App Store Connect API.
  return await profile.regenerateAsync();
}

export async function useExistingProvisioningProfileAsync(
  authCtx: AuthCtx,
  bundleIdentifier: string,
  provisioningProfile: ProvisioningProfile,
  distCert: DistributionCertificate
): Promise<ProvisioningProfile> {
  if (!provisioningProfile.provisioningProfileId) {
    throw new Error('Provisioning profile: cannot use existing profile, insufficient id');
  }
  const certIdTag = distCert.certId ? ` (${distCert.certId})` : '';

  const spinner = ora(
    `Updating provisioning profile (${provisioningProfile.provisioningProfileId}) with distribution certificate${certIdTag}`
  ).start();
  try {
    if (!distCert.distCertSerialNumber) {
      distCert.distCertSerialNumber = findP12CertSerialNumber(
        distCert.certP12,
        distCert.certPassword
      );
    }

    const context = getRequestContext(authCtx);
    const profile = await addCertificateToProfileAsync(context, {
      serialNumber: distCert.distCertSerialNumber,
      profileId: provisioningProfile.provisioningProfileId,
      bundleIdentifier,
    });
    const content = profile.attributes.profileContent;
    if (!content) {
      // this should never happen because of the regen.
      throw new Error(
        `Provisioning profile "${profile.attributes.name}" (${profile.id}) is expired!`
      );
    }
    const result = {
      provisioningProfileId: profile.id,
      provisioningProfile: content,
      teamId: authCtx.team.id,
      teamName: authCtx.team.name,
    };
    spinner.succeed(
      `Updated provisioning profile (${profile.id}) with distribution certificate${certIdTag}`
    );
    return {
      ...result,
      teamId: authCtx.team.id,
      teamName: authCtx.team.name,
    };
  } catch (error) {
    spinner.fail(
      `Failed to update provisioning profile (${provisioningProfile.provisioningProfileId}) with distribution certificate${certIdTag}`
    );
    throw error;
  }
}

export async function listProvisioningProfilesAsync(
  authCtx: AuthCtx,
  bundleIdentifier: string,
  applePlatform: ApplePlatform,
  profileClass: ProfileClass = ProfileClass.General
): Promise<ProvisioningProfileStoreInfo[]> {
  const spinner = ora(`Fetching Apple provisioning profiles`).start();
  try {
    const context = getRequestContext(authCtx);
    const profileType = resolveProfileType(applePlatform, profileClass, authCtx.team.inHouse);
    const profiles = (await getProfilesForBundleIdAsync(context, bundleIdentifier)).filter(
      profile => profile.attributes.profileType === profileType
    );

    const result = await Promise.all(
      profiles.map(profile => transformProfileAsync(profile, authCtx))
    );

    spinner.succeed(`Fetched Apple provisioning profiles`);
    return result;
  } catch (error) {
    spinner.fail(`Failed to fetch Apple provisioning profiles`);
    throw error;
  }
}

export async function createProvisioningProfileAsync(
  authCtx: AuthCtx,
  bundleIdentifier: string,
  distCert: DistributionCertificate,
  profileName: string,
  applePlatform: ApplePlatform,
  profileClass: ProfileClass = ProfileClass.General
): Promise<ProvisioningProfile> {
  const spinner = ora(`Creating Apple provisioning profile`).start();
  try {
    if (!distCert.distCertSerialNumber) {
      distCert.distCertSerialNumber = findP12CertSerialNumber(
        distCert.certP12,
        distCert.certPassword
      );
    }

    const context = getRequestContext(authCtx);
    const profileType = resolveProfileType(applePlatform, profileClass, authCtx.team.inHouse);

    const certificate = await getCertificateBySerialNumberAsync(
      context,
      distCert.distCertSerialNumber
    );

    const bundleIdItem = await getBundleIdForIdentifierAsync(context, bundleIdentifier);

    const profile = await Profile.createAsync(context, {
      bundleId: bundleIdItem.id,
      name: profileName,
      certificates: [certificate.id],
      devices: [],
      profileType,
    });

    const result = await transformProfileAsync(profile, authCtx);

    spinner.succeed('Created Apple provisioning profile');
    return result;
  } catch (error) {
    spinner.fail('Failed to create Apple provisioning profile');
    throw error;
  }
}

export async function revokeProvisioningProfileAsync(
  authCtx: AuthCtx,
  bundleIdentifier: string,
  applePlatform: ApplePlatform,
  profileClass: ProfileClass = ProfileClass.General
): Promise<void> {
  const spinner = ora(`Revoking Apple provisioning profile`).start();
  try {
    const context = getRequestContext(authCtx);

    const profiles = await getProfilesForBundleIdAsync(context, bundleIdentifier);
    const profileType = resolveProfileType(applePlatform, profileClass, authCtx.team.inHouse);
    await Promise.all(
      profiles
        .filter(profile => profile.attributes.profileType === profileType)
        .map(profile => Profile.deleteAsync(context, { id: profile.id }))
    );
    spinner.succeed('Revoked Apple provisioning profile');
  } catch (error) {
    spinner.fail('Failed to revoke Apple provisioning profile');
    throw error;
  }
}
