import { PlistArray, PlistObject } from '@expo/plist';
import crypto from 'crypto';
import minimatch from 'minimatch';

import Log from '../../../log';
import { confirmAsync } from '../../../prompts';
import { Context } from '../../context';
import { DistributionCertificate, ProvisioningProfile } from '../appstore/Credentials.types';
import { getP12CertFingerprint } from '../utils/p12Certificate';
import { parse as parseProvisioningProfile } from '../utils/provisioningProfile';

interface ValidationResult {
  error?: string;
  ok: boolean;
}

export async function validateProvisioningProfileAsync(
  ctx: Context,
  profile: Pick<ProvisioningProfile, 'provisioningProfile' | 'provisioningProfileId'>,
  distCert: Pick<DistributionCertificate, 'certP12' | 'certPassword'>,
  bundleIdentifier: string
): Promise<ValidationResult> {
  const resultWithoutApple = validateProvisioningProfileWithoutApple(
    profile,
    distCert,
    bundleIdentifier
  );

  // already failed, return early
  if (!resultWithoutApple.ok) {
    return resultWithoutApple;
  }

  if (!ctx.appStore.authCtx) {
    Log.warn(
      "Skipping Provisioning Profile validation on Apple Servers because we aren't authenticated."
    );
    return resultWithoutApple;
  }

  return await validateProvisioningProfileWithAppleAsync(ctx, profile, bundleIdentifier);
}

async function validateProvisioningProfileWithAppleAsync(
  ctx: Context,
  profile: Pick<ProvisioningProfile, 'provisioningProfile' | 'provisioningProfileId'>,
  bundleIdentifier: string
): Promise<ValidationResult> {
  const profilesFromApple = await ctx.appStore.listProvisioningProfilesAsync(bundleIdentifier);

  const configuredProfileFromApple = profilesFromApple.find(appleProfile =>
    profile.provisioningProfileId
      ? appleProfile.provisioningProfileId === profile.provisioningProfileId
      : appleProfile.provisioningProfile === profile.provisioningProfile
  );
  if (!configuredProfileFromApple) {
    return {
      error: `Provisioning profile (id: ${profile.provisioningProfileId}) does not exist in Apple Dev Portal`,
      ok: false,
    };
  }
  if (configuredProfileFromApple.status !== 'ACTIVE') {
    return {
      error: `Provisioning profile (id: ${profile.provisioningProfileId}) is no longer valid`,
      ok: false,
    };
  }
  return { ok: true };
}

export function validateProvisioningProfileWithoutApple(
  provisioningProfile: Pick<ProvisioningProfile, 'provisioningProfile' | 'provisioningProfileId'>,
  distCert: Pick<DistributionCertificate, 'certP12' | 'certPassword'>,
  bundleIdentifier: string
): ValidationResult {
  try {
    const profilePlist = parseProvisioningProfile(provisioningProfile.provisioningProfile);

    let distCertFingerprint: string;
    try {
      distCertFingerprint = getP12CertFingerprint(distCert.certP12, distCert.certPassword);
    } catch (e) {
      return {
        error: `Failed to calculate fingerprint for Distribution Certificate: ${e.toString()}`,
        ok: false,
      };
    }

    const devCertStatus = validateDeveloperCertificate(profilePlist, distCertFingerprint);
    if (!devCertStatus.ok) {
      return devCertStatus;
    }
    const bundleIdentifierStatus = validateBundleIdentifier(profilePlist, bundleIdentifier);
    if (!bundleIdentifierStatus.ok) {
      return bundleIdentifierStatus;
    }

    const isExpired = new Date(profilePlist['ExpirationDate'] as string) <= new Date();
    if (isExpired) {
      return {
        error: 'Provisioning Profile has expired.',
        ok: false,
      };
    }
  } catch (error) {
    return {
      error: 'Provisioning Profile is malformed.',
      ok: false,
    };
  }
  return {
    ok: true,
  };
}

function validateDeveloperCertificate(
  plistData: PlistObject,
  distCertFingerprint: string
): ValidationResult {
  const devCertBase64 = (plistData?.DeveloperCertificates as PlistArray)?.[0] as string;
  if (!devCertBase64) {
    return {
      error: 'Missing certificate fingerprint in provisioning profile.',
      ok: false,
    };
  }
  const devCertBuffer = Buffer.from(devCertBase64, 'base64');
  const devCertFingerprint = crypto
    .createHash('sha1')
    .update(devCertBuffer)
    .digest('hex')
    .toUpperCase();

  if (devCertFingerprint !== distCertFingerprint) {
    return {
      error: 'Provisioning profile is not associated with uploaded Distribution Certificate.',
      ok: false,
    };
  }
  return { ok: true };
}

function validateBundleIdentifier(
  plistData: PlistObject,
  expectedBundleIdentifier: string
): ValidationResult {
  const actualApplicationIdentifier = (plistData.Entitlements as PlistObject)?.[
    'application-identifier'
  ] as string;
  if (!actualApplicationIdentifier) {
    return {
      error: 'Missing application-identifier in provisioning profile entitlements',
      ok: false,
    };
  }
  const actualBundleIdentifier = /\.(.+)/.exec(actualApplicationIdentifier)?.[1] as string;
  if (!actualBundleIdentifier) {
    return {
      error: 'Malformed application-identifier field in provisioning profile',
      ok: false,
    };
  }

  if (!minimatch(expectedBundleIdentifier, actualBundleIdentifier)) {
    return {
      error: `Wrong bundleIdentifier found in provisioning profile; expected: ${expectedBundleIdentifier}, found (in provisioning profile): ${actualBundleIdentifier}`,
      ok: false,
    };
  }
  return { ok: true };
}
