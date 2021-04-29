import chalk from 'chalk';

import {
  AndroidAppBuildCredentialsFragment,
  CommonAndroidAppCredentialsFragment,
} from '../../../graphql/generated';
import Log from '../../../log';
import { fromNow } from '../../../utils/date';
import { AppLookupParams } from '../api/GraphqlClient';

export function displayEmptyAndroidCredentials(appLookupParams: AppLookupParams): void {
  const { projectName, androidApplicationIdentifier } = appLookupParams;
  Log.log(chalk.bold(`Android Credentials`));
  Log.log(`  Project: ${projectName}`);
  Log.log(`  Application Identifier: ${androidApplicationIdentifier}`);
  Log.log(`  No credentials set up yet!`);
}

/**
 * sort a build credentials array in descending order of preference
 * prefer default credentials, then prefer names that come first lexicographically
 */
function sortBuildCredentials(
  androidAppBuildCredentialsList: AndroidAppBuildCredentialsFragment[]
): AndroidAppBuildCredentialsFragment[] {
  return androidAppBuildCredentialsList.sort((buildCredentialsA, buildCredentialsB) => {
    if (buildCredentialsA.isDefault) {
      return -1;
    } else if (buildCredentialsB.isDefault) {
      return 1;
    }
    return buildCredentialsA.name.localeCompare(buildCredentialsB.name);
  });
}

function displayLegacyAndroidAppCredentials(
  legacyAppCredentials: CommonAndroidAppCredentialsFragment,
  appCredentials: CommonAndroidAppCredentialsFragment | null
): void {
  if (appCredentials) {
    // differentiate between old and new if there's both
    Log.log(chalk.bold(`  Credentials ported from Expo Classic (expo-cli):`));
  }
  // There can only be one set of build credentials in legacy app credentials
  const [legacyBuildCredentials] = legacyAppCredentials.androidAppBuildCredentialsList;
  if (legacyBuildCredentials) {
    displayAndroidBuildCredentials(
      legacyBuildCredentials,
      /* only one set to show, skip config display */ true
    );
  }
}

function displayEASAndroidAppCredentials(
  legacyAppCredentials: CommonAndroidAppCredentialsFragment | null,
  appCredentials: CommonAndroidAppCredentialsFragment
): void {
  if (legacyAppCredentials) {
    // differentiate between old and new if there's both
    Log.log(chalk.bold(`  EAS Credentials:`));
    Log.log(`  These will take precedence over Expo Classic credentials`);
  }
  const sortedBuildCredentialsList = sortBuildCredentials(
    appCredentials.androidAppBuildCredentialsList
  );
  for (const buildCredentials of sortedBuildCredentialsList) {
    displayAndroidBuildCredentials(buildCredentials);
  }
}

function formatFingerprint(fingerprint: string | null): string {
  if (!fingerprint) {
    return 'unavailable';
  }
  const uppercaseFingerprint = fingerprint.toUpperCase();
  const bytes = [];
  for (let i = 0; i < uppercaseFingerprint.length; i++) {
    const halfByte = uppercaseFingerprint.charAt(i);
    if (i % 2 === 0) {
      bytes.push(halfByte); // first half of the byte
    } else {
      bytes[bytes.length - 1] += halfByte; // second half of the byte
    }
  }
  return bytes.join(':');
}
function displayAndroidBuildCredentials(
  buildCredentials: AndroidAppBuildCredentialsFragment,
  skipConfigurationDisplay?: boolean
): void {
  if (!skipConfigurationDisplay) {
    const { isDefault, name } = buildCredentials;
    Log.log(chalk.bold(`  Configuration: ${name}${isDefault ? ' (Default)' : ''}`));
    Log.newLine();
  }

  const maybeKeystore = buildCredentials.androidKeystore;
  Log.log(`  Keystore:`);
  if (maybeKeystore) {
    const {
      keyAlias,
      type,
      md5CertificateFingerprint,
      sha1CertificateFingerprint,
      sha256CertificateFingerprint,
      updatedAt,
    } = maybeKeystore;
    Log.log(`    Type: ${type}`);
    Log.log(`    Key Alias: ${keyAlias}`);

    Log.log(`    MD5 Fingerprint: ${formatFingerprint(md5CertificateFingerprint ?? null)}`);
    Log.log(`    SHA1 Fingerprint: ${formatFingerprint(sha1CertificateFingerprint ?? null)}`);
    Log.log(`    SHA256 Fingerprint: ${formatFingerprint(sha256CertificateFingerprint ?? null)}`);
    Log.log(`    Updated ${fromNow(new Date(updatedAt))} ago`);
  } else {
    Log.log(`    None assigned yet`);
  }
  Log.newLine();
}

export function displayAndroidAppCredentials({
  appLookupParams,
  legacyAppCredentials,
  appCredentials,
}: {
  appLookupParams: AppLookupParams;
  legacyAppCredentials: CommonAndroidAppCredentialsFragment | null;
  appCredentials: CommonAndroidAppCredentialsFragment | null;
}): void {
  const { projectName, androidApplicationIdentifier } = appLookupParams;
  Log.log(chalk.bold(`Android Credentials`));
  Log.log(`  Project: ${projectName}`);
  Log.log(`  Application Identifier: ${androidApplicationIdentifier}`);
  Log.newLine();

  if (appCredentials) {
    displayEASAndroidAppCredentials(legacyAppCredentials, appCredentials);
  }

  if (legacyAppCredentials) {
    displayLegacyAndroidAppCredentials(legacyAppCredentials, appCredentials);
  }
}
