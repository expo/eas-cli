import ora from 'ora';

import { findP12CertSerialNumber } from '../utils/p12Certificate';
import {
  DistributionCertificate,
  ProvisioningProfile,
  ProvisioningProfileStoreInfo,
} from './Credentials.types';
import { AuthCtx } from './authenticate';
import { runActionAsync, travelingFastlane } from './fastlane';

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
    const result = await runActionAsync(travelingFastlane.manageProvisioningProfiles, args);
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
    const args = [
      'revoke',
      ctx.appleId,
      ctx.appleIdPassword,
      ctx.team.id,
      String(ctx.team.inHouse),
      bundleIdentifier,
    ];
    await runActionAsync(travelingFastlane.manageProvisioningProfiles, args);
    spinner.succeed();
  } catch (error) {
    spinner.fail('Failed to revoke Provisioning Profile on Apple Servers');
    throw error;
  }
}
