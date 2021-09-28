import chalk from 'chalk';

import {
  AndroidAppBuildCredentialsFragment,
  AndroidFcmVersion,
  AndroidKeystoreFragment,
  CommonAndroidAppCredentialsFragment,
  FcmSnippetLegacy,
  FcmSnippetV1,
} from '../../../graphql/generated';
import Log from '../../../log';
import { fromNow } from '../../../utils/date';
import formatFields from '../../../utils/formatFields';
import { sortBuildCredentials } from '../actions/BuildCredentialsUtils';
import { AppLookupParams } from '../api/GraphqlClient';

export function displayEmptyAndroidCredentials(appLookupParams: AppLookupParams): void {
  const { projectName, androidApplicationIdentifier } = appLookupParams;
  Log.log(chalk.bold(`Android Credentials`));
  Log.log(`  Project: ${projectName}`);
  Log.log(`  Application Identifier: ${androidApplicationIdentifier}`);
  Log.log(`  No credentials set up yet!`);
}

function displayAndroidFcmCredentials(appCredentials: CommonAndroidAppCredentialsFragment): void {
  const maybeFcm = appCredentials.androidFcm;
  Log.log(`  Push Notifications (FCM):`);
  if (!maybeFcm) {
    Log.log(`    None assigned yet`);
    Log.newLine();
    return;
  }
  const { snippet, version, updatedAt } = maybeFcm;
  if (version === AndroidFcmVersion.Legacy) {
    const { firstFourCharacters, lastFourCharacters } = snippet as FcmSnippetLegacy;
    Log.log(`    Key: ${firstFourCharacters}...${lastFourCharacters}`);
  } else if (version === AndroidFcmVersion.V1) {
    const { projectId, serviceAccountEmail, clientId, keyId } = snippet as FcmSnippetV1;
    Log.log(`    Project Id: ${projectId}`);
    Log.log(`    Service Account: ${serviceAccountEmail}`);
    Log.log(`    Client Id: ${clientId}`);
    Log.log(`    Key Id: ${keyId}`);
  }
  Log.log(`    Updated ${fromNow(new Date(updatedAt))} ago`);
  Log.newLine();
}

function displayGoogleServiceAccountKeyForSubmissions(
  appCredentials: CommonAndroidAppCredentialsFragment
): void {
  const maybeGsaKey = appCredentials.googleServiceAccountKeyForSubmissions;
  Log.log(
    formatFields([{ label: 'Google Service Account Key For Submissions', value: '' }], {
      labelFormat: chalk.cyan.bold,
    })
  );
  if (!maybeGsaKey) {
    Log.log(
      formatFields([{ label: '', value: 'None assigned yet' }], {
        labelFormat: chalk.cyan.bold,
      })
    );
    Log.newLine();
    return;
  }
  const { projectIdentifier, privateKeyIdentifier, clientEmail, clientIdentifier, updatedAt } =
    maybeGsaKey;

  const fields = [
    { label: 'Project ID', value: projectIdentifier },
    { label: 'Client Email', value: clientEmail },
    { label: 'Client ID', value: clientIdentifier },
    { label: 'Private Key ID', value: privateKeyIdentifier },
    { label: 'Updated', value: `${fromNow(new Date(updatedAt))} ago` },
  ];
  Log.log(formatFields(fields, { labelFormat: chalk.cyan.bold }));
  Log.newLine();
}

function displayEASAndroidAppCredentials(
  appCredentials: CommonAndroidAppCredentialsFragment
): void {
  displayAndroidFcmCredentials(appCredentials);
  displayGoogleServiceAccountKeyForSubmissions(appCredentials);
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
  }

  const maybeKeystore = buildCredentials.androidKeystore;
  Log.log(`  Keystore:`);
  if (maybeKeystore) {
    displayAndroidKeystore(maybeKeystore);
  } else {
    Log.log(`    None assigned yet`);
  }
  Log.newLine();
}

export function displayAndroidKeystore(keystore: AndroidKeystoreFragment): void {
  const {
    keyAlias,
    type,
    md5CertificateFingerprint,
    sha1CertificateFingerprint,
    sha256CertificateFingerprint,
    updatedAt,
  } = keystore;
  Log.log(`    Type: ${type}`);
  Log.log(`    Key Alias: ${keyAlias}`);

  Log.log(`    MD5 Fingerprint: ${formatFingerprint(md5CertificateFingerprint ?? null)}`);
  Log.log(`    SHA1 Fingerprint: ${formatFingerprint(sha1CertificateFingerprint ?? null)}`);
  Log.log(`    SHA256 Fingerprint: ${formatFingerprint(sha256CertificateFingerprint ?? null)}`);
  Log.log(`    Updated ${fromNow(new Date(updatedAt))} ago`);
}

export function displayAndroidAppCredentials({
  appLookupParams,
  appCredentials,
}: {
  appLookupParams: AppLookupParams;
  appCredentials: CommonAndroidAppCredentialsFragment | null;
}): void {
  const { projectName, androidApplicationIdentifier } = appLookupParams;
  Log.log(chalk.bold(`Android Credentials`));
  Log.log(`  Project: ${projectName}`);
  Log.log(`  Application Identifier: ${androidApplicationIdentifier}`);
  Log.newLine();

  if (appCredentials) {
    displayEASAndroidAppCredentials(appCredentials);
  }
}
