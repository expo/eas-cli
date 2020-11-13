import { Certificate, Profile, ProfileType } from '@expo/apple-utils';
import ora from 'ora';

import { findP12CertSerialNumber } from '../utils/p12Certificate';
import {
  DistributionCertificate,
  ProvisioningProfile,
  ProvisioningProfileStoreInfo,
} from './Credentials.types';
import { AuthCtx } from './authenticate';
import { getBundleIdForIdentifierAsync, getProfilesForBundleIdAsync } from './bundleId';
import { getCertificateBySerialNumberAsync, transformCertificate } from './distributionCertificate';
import { USE_APPLE_UTILS } from './experimental';
import { runActionAsync, travelingFastlane } from './fastlane';

async function transformProfileAsync(
  cert: Profile,
  ctx: AuthCtx
): Promise<ProvisioningProfileStoreInfo> {
  return {
    provisioningProfileId: cert.id,
    name: cert.attributes.name,
    status: cert.attributes.profileState,
    expires: new Date(cert.attributes.expirationDate).getTime() / 1000,
    distributionMethod: cert.attributes.profileType,
    // @ts-ignore -- this can be null when the profile has expired.
    provisioningProfile: cert.attributes.profileContent,
    certificates: (await cert.getCertificatesAsync()).map(transformCertificate),
    teamId: ctx.team.id,
    teamName: ctx.team.name,
  };
}

async function addCertificateToProfileAsync({
  serialNumber,
  profileId,
  bundleIdentifier,
}: {
  serialNumber: string;
  profileId: string;
  bundleIdentifier: string;
}) {
  const cert = await getCertificateBySerialNumberAsync(serialNumber);

  const profiles = await getProfilesForBundleIdAsync(bundleIdentifier);
  const profile = profiles.find(profile => profile.id === profileId);
  if (!profile) {
    throw new Error(
      `Failed to find profile for bundle identifier "${bundleIdentifier}" with profile id "${profileId}"`
    );
  }

  // Assign the new certificate
  profile.attributes.certificates = [cert];
  return await profile.regenerateAsync();
}

export async function useExistingProvisioningProfileAsync(
  ctx: AuthCtx,
  bundleIdentifier: string,
  provisioningProfile: ProvisioningProfile,
  distCert: DistributionCertificate
): Promise<ProvisioningProfile> {
  const spinner = ora(`Configuring existing Provisioning Profiles from Apple...`).start();
  try {
    if (!provisioningProfile.provisioningProfileId) {
      throw new Error('Provisioning profile: cannot use existing profile, insufficient id');
    }

    if (!distCert.distCertSerialNumber) {
      distCert.distCertSerialNumber = findP12CertSerialNumber(
        distCert.certP12,
        distCert.certPassword
      );
    }

    let result: ProvisioningProfile;

    if (USE_APPLE_UTILS) {
      const profile = await addCertificateToProfileAsync({
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
      result = {
        provisioningProfileId: profile.id,
        provisioningProfile: content,
        teamId: ctx.team.id,
        teamName: ctx.team.name,
      };
    } else {
      const args = [
        'use-existing',
        ctx.appleId,
        ctx.appleIdPassword,
        ctx.team.id,
        String(ctx.team.inHouse),
        bundleIdentifier,
        provisioningProfile.provisioningProfileId,
        distCert.distCertSerialNumber,
      ];
      result = await runActionAsync(travelingFastlane.manageProvisioningProfiles, args);
    }

    spinner.succeed();
    return {
      ...result,
      teamId: ctx.team.id,
      teamName: ctx.team.name,
    };
  } catch (error) {
    spinner.fail();
    throw error;
  }
}

export async function listProvisioningProfilesAsync(
  ctx: AuthCtx,
  bundleIdentifier: string
): Promise<ProvisioningProfileStoreInfo[]> {
  const spinner = ora(`Getting Provisioning Profiles from Apple...`).start();
  try {
    if (USE_APPLE_UTILS) {
      const type = ctx.team.inHouse ? ProfileType.IOS_APP_INHOUSE : ProfileType.IOS_APP_STORE;
      const profiles = (await getProfilesForBundleIdAsync(bundleIdentifier)).filter(
        profile => profile.attributes.profileType === type
      );

      const result = await Promise.all(
        profiles.map(profile => transformProfileAsync(profile, ctx))
      );
      spinner.succeed();
      return result;
    } else {
      const args = [
        'list',
        ctx.appleId,
        ctx.appleIdPassword,
        ctx.team.id,
        String(ctx.team.inHouse),
        bundleIdentifier,
      ];
      const { profiles } = await runActionAsync(travelingFastlane.manageProvisioningProfiles, args);
      spinner.succeed();
      return profiles.map((profile: Omit<ProvisioningProfileStoreInfo, 'teamId' | 'teamName'>) => ({
        ...profile,
        teamId: ctx.team.id,
        teamName: ctx.team.name,
      }));
    }
  } catch (error) {
    spinner.fail();
    throw error;
  }
}

export async function createProvisioningProfileAsync(
  ctx: AuthCtx,
  bundleIdentifier: string,
  distCert: DistributionCertificate,
  profileName: string
): Promise<ProvisioningProfile> {
  const spinner = ora(`Creating Provisioning Profile on Apple Servers...`).start();
  try {
    if (!distCert.distCertSerialNumber) {
      distCert.distCertSerialNumber = findP12CertSerialNumber(
        distCert.certP12,
        distCert.certPassword
      );
    }

    if (USE_APPLE_UTILS) {
      const profileType = ctx.team.inHouse
        ? ProfileType.IOS_APP_INHOUSE
        : ProfileType.IOS_APP_STORE;

      const certificate = await Certificate.getAsync({
        query: { filter: { serialNumber: [distCert.distCertSerialNumber] } },
      });

      const bundleIdItem = await getBundleIdForIdentifierAsync(bundleIdentifier);

      const profile = await Profile.createAsync({
        bundleId: bundleIdItem.id,
        name: profileName,
        certificates: certificate.map(cert => cert.id),
        devices: [],
        profileType,
      });

      const result = await transformProfileAsync(profile, ctx);
      spinner.succeed();
      return result;
    } else {
      const args = [
        'create',
        ctx.appleId,
        ctx.appleIdPassword,
        ctx.team.id,
        String(ctx.team.inHouse),
        bundleIdentifier,
        distCert.distCertSerialNumber,
        profileName,
      ];
      const result = await runActionAsync(travelingFastlane.manageProvisioningProfiles, args);
      spinner.succeed();
      return {
        ...result,
        teamId: ctx.team.id,
        teamName: ctx.team.name,
      };
    }
  } catch (error) {
    spinner.fail('Failed to create Provisioning Profile on Apple Servers');
    throw error;
  }
}

export async function revokeProvisioningProfileAsync(
  ctx: AuthCtx,
  bundleIdentifier: string
): Promise<void> {
  const spinner = ora(`Revoking Provisioning Profile on Apple Servers...`).start();
  try {
    if (USE_APPLE_UTILS) {
      const profiles = await getProfilesForBundleIdAsync(bundleIdentifier);
      for (const profile of profiles) {
        await Profile.deleteAsync({ id: profile.id });
      }
    } else {
      const args = [
        'revoke',
        ctx.appleId,
        ctx.appleIdPassword,
        ctx.team.id,
        String(ctx.team.inHouse),
        bundleIdentifier,
      ];
      await runActionAsync(travelingFastlane.manageProvisioningProfiles, args);
    }

    spinner.succeed();
  } catch (error) {
    spinner.fail('Failed to revoke Provisioning Profile on Apple Servers');
    throw error;
  }
}
