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
  const fields = [
    { label: 'Android Credentials', value: '' },
    { label: 'Project', value: projectName },
    { label: 'Application Identifier', value: androidApplicationIdentifier },
  ];
  Log.log(formatFields(fields, { labelFormat: chalk.cyan.bold }));
  Log.log(formatFields([{ label: 'No credentials set up yet!', value: '' }]));
  Log.newLine();
}

function displayAndroidFcmCredentials(appCredentials: CommonAndroidAppCredentialsFragment): void {
  const maybeFcm = appCredentials.androidFcm;
  Log.log(
    formatFields([{ label: 'Push Notifications (FCM Legacy)', value: '' }], {
      labelFormat: chalk.cyan.bold,
    })
  );
  if (!maybeFcm) {
    Log.log(formatFields([{ label: '', value: 'None assigned yet' }]));
    Log.newLine();
    return;
  }
  const { snippet, version, updatedAt } = maybeFcm;
  const fields = [];
  if (version === AndroidFcmVersion.Legacy) {
    const { firstFourCharacters, lastFourCharacters } = snippet as FcmSnippetLegacy;
    fields.push({ label: 'Key', value: `${firstFourCharacters}...${lastFourCharacters}` });
  } else if (version === AndroidFcmVersion.V1) {
    const { projectId, serviceAccountEmail, clientId, keyId } = snippet as FcmSnippetV1;
    fields.push({ label: 'Project ID', value: projectId });
    fields.push({ label: 'Client Email', value: serviceAccountEmail });
    fields.push({ label: 'Client ID', value: clientId ?? 'Unknown' });
    fields.push({ label: 'Private Key ID', value: keyId });
  }
  fields.push({ label: 'Updated', value: `${fromNow(new Date(updatedAt))} ago` });
  Log.log(formatFields(fields, { labelFormat: chalk.cyan.bold }));
  Log.newLine();
}

function displayGoogleServiceAccountKeyForSubmissions(
  appCredentials: CommonAndroidAppCredentialsFragment
): void {
  const maybeGsaKey = appCredentials.googleServiceAccountKeyForSubmissions;
  Log.log(
    formatFields(
      [{ label: 'Submissions: Google Service Account Key for Play Store Submissions', value: '' }],
      {
        labelFormat: chalk.cyan.bold,
      }
    )
  );
  if (!maybeGsaKey) {
    Log.log(formatFields([{ label: '', value: 'None assigned yet' }]));
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

function displayGoogleServiceAccountKeyForFcmV1(
  appCredentials: CommonAndroidAppCredentialsFragment
): void {
  const maybeGsaKey = appCredentials.googleServiceAccountKeyForFcmV1;
  Log.log(
    formatFields(
      [{ label: 'Push Notifications (FCM V1): Google Service Account Key For FCM V1', value: '' }],
      {
        labelFormat: chalk.cyan.bold,
      }
    )
  );
  if (!maybeGsaKey) {
    Log.log(formatFields([{ label: '', value: 'None assigned yet' }]));
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
  displayGoogleServiceAccountKeyForFcmV1(appCredentials);
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
  buildCredentials: AndroidAppBuildCredentialsFragment
): void {
  const { isDefault, name } = buildCredentials;
  Log.log(
    formatFields([{ label: `Configuration: ${name}${isDefault ? ' (Default)' : ''}`, value: '' }], {
      labelFormat: chalk.cyan.bold,
    })
  );

  const maybeKeystore = buildCredentials.androidKeystore;
  Log.log(
    formatFields([{ label: 'Keystore', value: '' }], {
      labelFormat: chalk.cyan.bold,
    })
  );
  if (maybeKeystore) {
    displayAndroidKeystore(maybeKeystore);
  } else {
    Log.log(formatFields([{ label: '', value: 'None assigned yet' }]));
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
  const fields = [
    { label: 'Type', value: type },
    { label: 'Key Alias', value: keyAlias },
    { label: 'MD5 Fingerprint', value: formatFingerprint(md5CertificateFingerprint ?? null) },
    { label: 'SHA1 Fingerprint', value: formatFingerprint(sha1CertificateFingerprint ?? null) },
    { label: 'SHA256 Fingerprint', value: formatFingerprint(sha256CertificateFingerprint ?? null) },
    { label: 'Updated', value: `${fromNow(new Date(updatedAt))} ago` },
  ];
  Log.log(formatFields(fields, { labelFormat: chalk.cyan.bold }));
}

export function displayAndroidAppCredentials({
  appLookupParams,
  appCredentials,
}: {
  appLookupParams: AppLookupParams;
  appCredentials: CommonAndroidAppCredentialsFragment | null;
}): void {
  const { projectName, androidApplicationIdentifier } = appLookupParams;
  const fields = [
    { label: 'Android Credentials', value: '' },
    { label: 'Project', value: projectName },
    { label: 'Application Identifier', value: androidApplicationIdentifier },
  ];
  Log.log(formatFields(fields, { labelFormat: chalk.cyan.bold }));
  Log.newLine();

  if (appCredentials) {
    displayEASAndroidAppCredentials(appCredentials);
  }
}
