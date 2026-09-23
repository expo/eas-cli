import { ExpoConfig } from '@expo/config';
import { Platform } from '@expo/eas-build-job';
import { EasJsonAccessor, EasJsonUtils } from '@expo/eas-json';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { AndroidAppCredentialsQuery } from '../../credentials/android/api/graphql/queries/AndroidAppCredentialsQuery';
import { AppleTeamQuery } from '../../credentials/ios/api/graphql/queries/AppleTeamQuery';
import Log from '../../log';

import { DetourSigningIdentity } from './api';

/**
 * What Detour needs to verify a link domain. Best effort: a missing value only
 * leaves the matching dashboard field empty.
 */
export async function collectSigningIdentityAsync(
  graphqlClient: ExpoGraphqlClient,
  exp: ExpoConfig,
  { accountName, projectDir }: { accountName: string; projectDir: string }
): Promise<DetourSigningIdentity> {
  const [teamId, certificateFingerprints, appStoreId] = await Promise.all([
    resolveAppleTeamIdentifierAsync(graphqlClient, accountName),
    resolveAndroidFingerprintsAsync(graphqlClient, exp, accountName),
    resolveAscAppIdAsync(projectDir),
  ]);

  return {
    bundleId: exp.ios?.bundleIdentifier,
    packageName: exp.android?.package,
    teamId,
    certificateFingerprints,
    appStoreId,
  };
}

/** Read from eas.json: asking App Store Connect means an Apple login. */
async function resolveAscAppIdAsync(projectDir: string): Promise<string | undefined> {
  try {
    const profile = await EasJsonUtils.getSubmitProfileAsync(
      EasJsonAccessor.fromProjectPath(projectDir),
      Platform.IOS,
      undefined
    );
    return profile.ascAppId;
  } catch (error) {
    Log.debug(error);
    return undefined;
  }
}

async function resolveAppleTeamIdentifierAsync(
  graphqlClient: ExpoGraphqlClient,
  accountName: string
): Promise<string | undefined> {
  try {
    const teams = await AppleTeamQuery.getAllForAccountAsync(graphqlClient, { accountName });
    // Guessing between teams breaks Universal Links silently.
    if (teams.length !== 1) {
      return undefined;
    }
    return teams[0].appleTeamIdentifier;
  } catch (error) {
    Log.debug(error);
    return undefined;
  }
}

export async function resolveAndroidFingerprintsAsync(
  graphqlClient: ExpoGraphqlClient,
  exp: ExpoConfig,
  accountName: string
): Promise<string[] | undefined> {
  const androidApplicationIdentifier = exp.android?.package;
  if (!androidApplicationIdentifier || !exp.slug) {
    return undefined;
  }
  try {
    const credentials =
      await AndroidAppCredentialsQuery.withCommonFieldsByApplicationIdentifierAsync(
        graphqlClient,
        `@${accountName}/${exp.slug}`,
        { androidApplicationIdentifier }
      );
    // A link has to open a dev build and a store install, signed differently.
    const fingerprints = (credentials?.androidAppBuildCredentialsList ?? [])
      .map(buildCredentials => buildCredentials.androidKeystore?.sha256CertificateFingerprint)
      .filter((fingerprint): fingerprint is string => Boolean(fingerprint));
    return fingerprints.length > 0 ? [...new Set(fingerprints)] : undefined;
  } catch (error) {
    Log.debug(error);
    return undefined;
  }
}
