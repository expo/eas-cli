import { PlistArray, PlistObject } from '@expo/plist';
import assert from 'assert';
import crypto from 'crypto';
import minimatch from 'minimatch';
import nullthrows from 'nullthrows';

import { IosAppBuildCredentialsFragment, IosDistributionType } from '../../../graphql/generated';
import Log from '../../../log';
import { getApplePlatformFromTarget } from '../../../project/ios/target';
import { CredentialsContext } from '../../context';
import { AppLookupParams } from '../api/graphql/types/AppLookupParams';
import { ProfileClass } from '../appstore/provisioningProfile';
import { Target } from '../types';
import { getP12CertFingerprint } from '../utils/p12Certificate';
import { parse as parseProvisioningProfile } from '../utils/provisioningProfile';

export async function validateProvisioningProfileAsync(
  ctx: CredentialsContext,
  target: Target,
  app: AppLookupParams,
  buildCredentials: Partial<IosAppBuildCredentialsFragment> | null
): Promise<boolean> {
  if (!buildCredentials?.distributionCertificate || !buildCredentials.provisioningProfile) {
    return false;
  }

  const resultWithoutApple = validateProvisioningProfileWithoutApple(app, buildCredentials);
  if (!resultWithoutApple) {
    return false;
  }

  if (!ctx.appStore.authCtx) {
    Log.warn(
      "Skipping Provisioning Profile validation on Apple Servers because we aren't authenticated."
    );
    return true;
  }

  return await validateProvisioningProfileWithAppleAsync(ctx, target, app, buildCredentials);
}

function validateProvisioningProfileWithoutApple(
  app: AppLookupParams,
  { provisioningProfile, distributionCertificate }: Partial<IosAppBuildCredentialsFragment>
): boolean {
  try {
    const profilePlist = parseProvisioningProfile(
      nullthrows(provisioningProfile?.provisioningProfile)
    );

    let distCertFingerprint: string;
    try {
      distCertFingerprint = getP12CertFingerprint(
        nullthrows(distributionCertificate?.certificateP12),
        nullthrows(distributionCertificate?.certificatePassword)
      );
    } catch (e: any) {
      Log.warn(`Failed to calculate fingerprint for Distribution Certificate: ${e.toString()}`);
      return false;
    }

    const devCertStatus = validateDeveloperCertificate(profilePlist, distCertFingerprint);
    if (!devCertStatus) {
      return false;
    }

    const bundleIdentifierStatus = validateBundleIdentifier(profilePlist, app.bundleIdentifier);
    if (!bundleIdentifierStatus) {
      return false;
    }

    const isExpired = new Date(profilePlist['ExpirationDate'] as string) <= new Date();
    if (isExpired) {
      Log.warn('Provisioning Profile has expired.');
      return false;
    }
  } catch {
    Log.warn('Provisioning Profile is malformed.');
    return false;
  }
  return true;
}

async function validateProvisioningProfileWithAppleAsync(
  ctx: CredentialsContext,
  target: Target,
  app: AppLookupParams,
  buildCredentials: Partial<IosAppBuildCredentialsFragment>
): Promise<boolean> {
  assert(buildCredentials.provisioningProfile, 'Provisioning Profile must be defined');
  const { developerPortalIdentifier, provisioningProfile } = buildCredentials.provisioningProfile;

  const applePlatform = getApplePlatformFromTarget(target);
  const profilesFromApple = await ctx.appStore.listProvisioningProfilesAsync(
    app.bundleIdentifier,
    applePlatform,
    buildCredentials.iosDistributionType === IosDistributionType.AdHoc
      ? ProfileClass.Adhoc
      : ProfileClass.General
  );

  const configuredProfileFromApple = profilesFromApple.find(appleProfile =>
    developerPortalIdentifier
      ? appleProfile.provisioningProfileId === developerPortalIdentifier
      : appleProfile.provisioningProfile === provisioningProfile
  );
  if (!configuredProfileFromApple) {
    Log.warn(
      `Provisioning profile (id: ${developerPortalIdentifier}) does not exist in Apple Developer Portal`
    );
    return false;
  }
  if (configuredProfileFromApple.status !== 'ACTIVE') {
    Log.warn(`Provisioning profile (id: ${developerPortalIdentifier}) is no longer valid`);
    return false;
  }
  return true;
}

function validateDeveloperCertificate(
  plistData: PlistObject,
  distCertFingerprint: string
): boolean {
  const devCertBase64 = (plistData?.DeveloperCertificates as PlistArray)?.[0] as string;
  if (!devCertBase64) {
    Log.warn('Missing certificate fingerprint in provisioning profile.');
    return false;
  }
  const devCertBuffer = Buffer.from(devCertBase64, 'base64');
  const devCertFingerprint = crypto
    .createHash('sha1')
    .update(devCertBuffer)
    .digest('hex')
    .toUpperCase();

  if (devCertFingerprint !== distCertFingerprint) {
    Log.warn('Provisioning profile is not associated with uploaded Distribution Certificate.');
    return false;
  }
  return true;
}

function validateBundleIdentifier(
  plistData: PlistObject,
  expectedBundleIdentifier: string
): boolean {
  const actualApplicationIdentifier = (plistData.Entitlements as PlistObject)?.[
    'application-identifier'
  ] as string;
  if (!actualApplicationIdentifier) {
    Log.warn('Missing application-identifier in provisioning profile entitlements');
    return false;
  }
  const actualBundleIdentifier = /\.(.+)/.exec(actualApplicationIdentifier)?.[1] as string;
  if (!actualBundleIdentifier) {
    Log.warn('Malformed application-identifier field in provisioning profile');
    return false;
  }

  if (!minimatch(expectedBundleIdentifier, actualBundleIdentifier)) {
    Log.warn(
      `Wrong bundleIdentifier found in provisioning profile; expected: ${expectedBundleIdentifier}, found (in provisioning profile): ${actualBundleIdentifier}`
    );
    return false;
  }
  return true;
}
