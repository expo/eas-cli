import {
  Certificate,
  CertificateType,
  Device,
  Profile,
  ProfileState,
  ProfileType,
} from '@expo/apple-utils';
import ora from 'ora';

import { ProvisioningProfile } from './Credentials.types';
import { AuthCtx } from './authenticate';
import { getBundleIdForIdentifierAsync, getProfilesForBundleIdAsync } from './bundleId';
import { USE_APPLE_UTILS } from './experimental';
import { runActionAsync, travelingFastlane } from './fastlane';

interface ProfileResults {
  provisioningProfileUpdateTimestamp?: number;
  provisioningProfileCreateTimestamp?: number;
  provisioningProfileName?: string;
  provisioningProfileId: string;
  provisioningProfile: any;
}

async function registerMissingDevicesAsync(udids: string[]): Promise<Device[]> {
  const allIosProfileDevices = await Device.getAllIOSProfileDevicesAsync();
  const alreadyAdded = allIosProfileDevices.filter(d => udids.includes(d.attributes.udid));
  const alreadyAddedUdids = alreadyAdded.map(i => i.attributes.udid);

  for (const udid of udids) {
    if (!alreadyAddedUdids.includes(udid)) {
      const device = await Device.createAsync({ name: 'iOS Device (added by Expo)', udid });
      alreadyAdded.push(device);
    }
  }

  return alreadyAdded;
}

async function findDistCertAsync(serialNumber: string): Promise<Certificate | null> {
  const certs = await Certificate.getAsync({
    query: {
      filter: {
        certificateType: CertificateType.IOS_DISTRIBUTION,
      },
    },
  });

  if (serialNumber === '__last__') {
    return certs[certs.length - 1];
  }

  return certs.find(c => c.attributes.serialNumber === serialNumber) ?? null;
}

async function findProfileByBundleIdAsync(
  bundleId: string,
  certSerialNumber: string
): Promise<{
  profile: Profile | null;
  didUpdate: boolean;
}> {
  const expoProfiles = (await getProfilesForBundleIdAsync(bundleId))
    .filter(profile => profile.attributes.profileType === ProfileType.IOS_APP_INHOUSE)
    .filter(profile => {
      return (
        profile.attributes.name.startsWith('*[expo]') &&
        profile.attributes.profileState !== ProfileState.EXPIRED
      );
    });

  const expoProfilesWithCert: Profile[] = [];
  // find profiles associated with our development cert
  for (const profile of expoProfiles) {
    const certificates = await profile.getCertificatesAsync();
    if (certificates.some(cert => cert.attributes.serialNumber === certSerialNumber)) {
      expoProfilesWithCert.push(profile);
    }
  }

  if (expoProfilesWithCert) {
    // there is an expo managed profile with our desired certificate
    // return the profile that will be valid for the longest duration
    return {
      profile: expoProfilesWithCert.sort(sortByExpiration)[expoProfilesWithCert.length - 1],
      didUpdate: false,
    };
  } else if (expoProfiles) {
    // there is an expo managed profile, but it doesn't have our desired certificate
    // append the certificate and update the profile
    const distCert = await findDistCertAsync(certSerialNumber);
    if (!distCert) throw new Error('expected cert not found');
    const profile = expoProfiles.sort(sortByExpiration)[expoProfiles.length - 1];
    profile.attributes.certificates = [distCert];
    return { profile: await profile.regenerateAsync(), didUpdate: true };
  }

  // there is no valid provisioning profile available
  return { profile: null, didUpdate: false };
}

function sortByExpiration(a: Profile, b: Profile): number {
  return (
    new Date(a.attributes.expirationDate).getTime() -
    new Date(b.attributes.expirationDate).getTime()
  );
}

async function findProfileByIdAsync(profileId: string, bundleId: string): Promise<Profile | null> {
  let profiles = await getProfilesForBundleIdAsync(bundleId);
  profiles = profiles.filter(
    profile => profile.attributes.profileType === ProfileType.IOS_APP_ADHOC
  );
  return profiles.find(profile => profile.id === profileId) ?? null;
}

function uniqueItems<T = any>(items: T[]): T[] {
  const set = new Set(items);
  // @ts-ignore: downlevel iteration
  return [...set];
}

async function manageAdHocProfilesAsync({
  udids,
  bundleId,
  certSerialNumber,
  profileId,
}: {
  udids: string[];
  bundleId: string;
  certSerialNumber: string;
  profileId?: string;
}): Promise<ProfileResults> {
  // We register all missing devices on the Apple Developer Portal. They are identified by UDIDs.
  const devices = await registerMissingDevicesAsync(udids);

  let existingProfile: Profile | null;
  let didUpdate = false;

  if (profileId) {
    existingProfile = await findProfileByIdAsync(profileId, bundleId);
    // Fail if we cannot find the profile that was specifically requested
    if (!existingProfile)
      throw new Error(
        `Could not find profile with profile id "${profileId}" for bundle id "${bundleId}"`
      );
  } else {
    // If no profile id is passed, try to find a suitable provisioning profile for the App ID.
    const results = await findProfileByBundleIdAsync(bundleId, certSerialNumber);
    existingProfile = results.profile;
    didUpdate = results.didUpdate;
  }

  if (existingProfile) {
    // We need to verify whether the existing profile includes all user's devices.
    let deviceUdidsInProfile =
      existingProfile?.attributes?.devices?.map?.(i => i.attributes.udid) ?? [];
    deviceUdidsInProfile = uniqueItems(deviceUdidsInProfile.filter(Boolean));
    const allDeviceUdids = uniqueItems(udids);
    const hasEqualUdids =
      deviceUdidsInProfile.length === allDeviceUdids.length &&
      deviceUdidsInProfile.every(udid => allDeviceUdids.includes(udid));
    if (hasEqualUdids && existingProfile.isValid()) {
      const result: ProfileResults = {
        provisioningProfileName: existingProfile?.attributes?.name,
        provisioningProfileId: existingProfile?.id,
        provisioningProfile: existingProfile?.attributes.profileContent,
      };
      if (didUpdate) {
        result.provisioningProfileUpdateTimestamp = Date.now();
      }

      return result;
    }
    // We need to add new devices to the list and create a new provisioning profile.
    existingProfile.attributes.devices = devices;
    await existingProfile.regenerateAsync();

    const updatedProfile = (await findProfileByBundleIdAsync(bundleId, certSerialNumber)).profile;
    if (!updatedProfile) throw new Error('Failed to locate updated profile');
    return {
      provisioningProfileUpdateTimestamp: Date.now(),
      provisioningProfileName: updatedProfile.attributes.name,
      provisioningProfileId: updatedProfile.id,
      provisioningProfile: updatedProfile.attributes.profileContent,
    };
  }

  // No existing profile...

  // We need to find user's distribution certificate to make a provisioning profile for it.
  const distCert = await findDistCertAsync(certSerialNumber);

  if (!distCert) {
    // If the distribution certificate doesn't exist, the user must have deleted it, we can't do anything here :(
    throw new Error('No distribution certificate available to make provisioning profile against');
  }
  const bundleIdItem = await getBundleIdForIdentifierAsync(bundleId);
  // If the provisioning profile for the App ID doesn't exist, we just need to create a new one!
  const newProfile = await Profile.createAsync({
    bundleId: bundleIdItem.id,
    // apple drops [ if its the first char (!!),
    name: `*[expo] ${bundleId} AdHoc ${Date.now()}`,
    certificates: [distCert.id],
    devices: devices.map(device => device.id),
    profileType: ProfileType.IOS_APP_ADHOC,
  });

  return {
    provisioningProfileUpdateTimestamp: Date.now(),
    provisioningProfileCreateTimestamp: Date.now(),
    provisioningProfileName: newProfile.attributes.name,
    provisioningProfileId: newProfile.id,
    provisioningProfile: newProfile.attributes.profileContent,
  };
}

export async function createOrReuseAdhocProvisioningProfileAsync(
  ctx: AuthCtx,
  udids: string[],
  bundleIdentifier: string,
  distCertSerialNumber: string
): Promise<ProvisioningProfile> {
  const spinner = ora(`Handling Adhoc provisioning profiles on Apple Developer Portal...`).start();
  try {
    let adhocProvisioningProfile: ProfileResults;

    if (USE_APPLE_UTILS) {
      adhocProvisioningProfile = await manageAdHocProfilesAsync({
        udids,
        bundleId: bundleIdentifier,
        certSerialNumber: distCertSerialNumber,
      });
    } else {
      const args = [
        '--apple-id',
        ctx.appleId,
        '--apple-password',
        ctx.appleIdPassword,
        ctx.team.id,
        udids.join(','),
        bundleIdentifier,
        distCertSerialNumber,
      ];
      adhocProvisioningProfile = await runActionAsync(
        travelingFastlane.manageAdHocProvisioningProfile,
        args
      );
    }

    const {
      provisioningProfileUpdateTimestamp,
      provisioningProfileCreateTimestamp,
      provisioningProfileName,
    } = adhocProvisioningProfile;
    if (provisioningProfileCreateTimestamp) {
      spinner.succeed(`Created new profile: ${provisioningProfileName}`);
    } else if (provisioningProfileUpdateTimestamp) {
      spinner.succeed(`Updated existing profile: ${provisioningProfileName}`);
    } else {
      spinner.succeed(`Used existing profile: ${provisioningProfileName}`);
    }

    delete adhocProvisioningProfile.provisioningProfileUpdateTimestamp;
    delete adhocProvisioningProfile.provisioningProfileCreateTimestamp;
    delete adhocProvisioningProfile.provisioningProfileName;

    return {
      ...adhocProvisioningProfile,
      teamId: ctx.team.id,
      teamName: ctx.team.name,
    };
  } catch (error) {
    spinner.fail();
    throw error;
  }
}
