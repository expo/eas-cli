import chalk from 'chalk';
import dateformat from 'dateformat';

import {
  AppStoreConnectApiKeyFragment,
  AppleDeviceFragment,
  ApplePushKeyFragment,
  IosAppBuildCredentialsFragment,
  IosDistributionType,
} from '../../../graphql/generated';
import { APPLE_DEVICE_CLASS_LABELS } from '../../../graphql/types/credentials/AppleDevice';
import Log from '../../../log';
import { fromNow } from '../../../utils/date';
import formatFields from '../../../utils/formatFields';
import { AppLookupParams } from '../api/graphql/types/AppLookupParams';
import { App, IosAppBuildCredentialsMap, IosAppCredentialsMap, Target } from '../types';

function prettyIosDistributionType(distributionType: IosDistributionType): string {
  switch (distributionType) {
    case IosDistributionType.AppStore:
      return 'App Store';
    case IosDistributionType.AdHoc:
      return 'Ad Hoc';
    case IosDistributionType.Development:
      return 'Development';
    case IosDistributionType.Enterprise:
      return 'Enterprise';
    default:
      return 'Unknown';
  }
}

export function displayEmptyIosCredentials(appLookupParams: AppLookupParams): void {
  const { projectName, bundleIdentifier } = appLookupParams;
  const fields = [
    { label: 'iOS Credentials', value: '' },
    { label: 'Project', value: projectName },
    { label: 'Bundle Identifier', value: bundleIdentifier },
  ];
  fields.push({ label: '', value: 'No credentials set up yet!' });
  fields.push({ label: '', value: '' });
  Log.log(formatFields(fields, { labelFormat: chalk.cyan.bold }));
}

/**
 * sort a build credentials array in descending order of preference
 */
function sortBuildCredentialsByDistributionType(
  iosAppBuildCredentialsList: IosAppBuildCredentialsFragment[]
): IosAppBuildCredentialsFragment[] {
  // The order in which we choose the distribution type from least to most preferred
  const typePriority = [
    IosDistributionType.Development,
    IosDistributionType.AdHoc,
    IosDistributionType.Enterprise,
    IosDistributionType.AppStore,
  ];
  return iosAppBuildCredentialsList
    .sort(
      (buildCredentialsA, buildCredentialsB) =>
        typePriority.indexOf(buildCredentialsA.iosDistributionType) -
        typePriority.indexOf(buildCredentialsB.iosDistributionType)
    )
    .reverse();
}

export function displayIosCredentials(
  app: App,
  appCredentialsMap: IosAppCredentialsMap,
  targets: Target[]
): void {
  const projectFullName = `@${app.account.name}/${app.projectName}`;
  const isMultitarget = targets.length > 1;

  const fields = [
    { label: 'iOS Credentials', value: '' },
    { label: 'Project', value: projectFullName },
  ];

  for (const { targetName, bundleIdentifier } of targets) {
    if (isMultitarget) {
      fields.push({ label: '', value: '' });
      fields.push({ label: 'Target', value: targetName });
    }
    fields.push({ label: 'Bundle Identifier', value: bundleIdentifier });

    const targetAppCredentials = appCredentialsMap[targetName];
    if (!targetAppCredentials) {
      fields.push({ label: '', value: '' });
      fields.push({ label: '', value: 'No credentials set up yet!' });
      fields.push({ label: '', value: '' });
      continue;
    }

    const { appleTeam, pushKey, appStoreConnectApiKeyForSubmissions } = targetAppCredentials;
    if (appleTeam) {
      const { appleTeamIdentifier, appleTeamName } = appleTeam;
      fields.push({
        label: 'Apple Team',
        value: `${appleTeamIdentifier} ${appleTeamName ? `(${appleTeamName})` : ''}`,
      });
    }
    fields.push({ label: '', value: '' });

    if (pushKey) {
      displayApplePushKey(pushKey, fields);
    }

    if (appStoreConnectApiKeyForSubmissions) {
      displayAscApiKey(appStoreConnectApiKeyForSubmissions, fields);
    }

    const sortedIosAppBuildCredentialsList = sortBuildCredentialsByDistributionType(
      targetAppCredentials.iosAppBuildCredentialsList
    );
    for (const iosAppBuildCredentials of sortedIosAppBuildCredentialsList) {
      displayIosAppBuildCredentials(iosAppBuildCredentials, fields);
    }
  }
  Log.log(formatFields(fields, { labelFormat: chalk.cyan.bold }));
}

export function displayProjectCredentials(
  app: App,
  appBuildCredentials: IosAppBuildCredentialsMap,
  targets: Omit<Target, 'entitlements'>[]
): void {
  const projectFullName = `@${app.account.name}/${app.projectName}`;
  const targetToBundleId = targets.reduce<Record<string, string>>((acc, target) => {
    acc[target.targetName] = target.bundleIdentifier;
    return acc;
  }, {});
  const isMultitarget = targets.length > 1;

  Log.addNewLineIfNone();
  Log.log(chalk.cyan.bold('Project Credentials Configuration'));
  Log.newLine();
  const fields = [{ label: 'Project', value: projectFullName }];
  for (const [targetName, buildCredentials] of Object.entries(appBuildCredentials)) {
    if (isMultitarget) {
      fields.push({ label: '', value: '' });
      fields.push({ label: 'Target', value: targetName });
    }
    fields.push({ label: 'Bundle Identifier', value: targetToBundleId[targetName] });
    displayIosAppBuildCredentials(buildCredentials, fields);
  }
  Log.log(formatFields(fields, { labelFormat: chalk.cyan.bold }));
}

function displayIosAppBuildCredentials(
  buildCredentials: IosAppBuildCredentialsFragment,
  fields: { label: string; value: string }[]
): void {
  fields.push({ label: '', value: '' });
  fields.push({
    label: `${prettyIosDistributionType(buildCredentials.iosDistributionType)} Configuration`,
    value: '',
  });
  fields.push({ label: '', value: '' });
  const maybeDistCert = buildCredentials.distributionCertificate;
  fields.push({ label: 'Distribution Certificate', value: '' });
  if (maybeDistCert) {
    const { serialNumber, updatedAt, validityNotAfter, appleTeam } = maybeDistCert;
    fields.push({ label: 'Serial Number', value: serialNumber });
    fields.push({
      label: 'Expiration Date',
      value: dateformat(validityNotAfter, 'expiresHeaderFormat'),
    });
    if (appleTeam) {
      const { appleTeamIdentifier, appleTeamName } = appleTeam;
      fields.push({
        label: 'Apple Team',
        value: `${appleTeamIdentifier} ${appleTeamName ? `(${appleTeamName})` : ''}`,
      });
    }
    fields.push({ label: 'Updated', value: `${fromNow(new Date(updatedAt))} ago` });
  } else {
    fields.push({ label: '', value: 'None assigned yet' });
  }
  fields.push({ label: '', value: '' });

  const maybeProvProf = buildCredentials.provisioningProfile;
  fields.push({ label: 'Provisioning Profile', value: '' });
  if (maybeProvProf) {
    const { expiration, updatedAt, status, developerPortalIdentifier, appleTeam, appleDevices } =
      maybeProvProf;
    if (developerPortalIdentifier) {
      fields.push({ label: 'Developer Portal ID', value: developerPortalIdentifier });
    }
    fields.push({ label: 'Status', value: status });
    fields.push({ label: 'Expiration', value: dateformat(expiration, 'expiresHeaderFormat') });
    if (appleTeam) {
      const { appleTeamIdentifier, appleTeamName } = appleTeam;
      fields.push({
        label: 'Apple Team',
        value: `${appleTeamIdentifier} ${appleTeamName ? `(${appleTeamName})` : ''}`,
      });
    }
    if (appleDevices && appleDevices.length > 0) {
      const [firstAppleDevice, ...rest] = appleDevices;
      fields.push({
        label: 'Provisioned devices',
        value: `- ${formatAppleDevice(firstAppleDevice)}`,
      });
      for (const appleDevice of rest) {
        fields.push({ label: '', value: `- ${formatAppleDevice(appleDevice)}` });
      }
    }
    fields.push({ label: 'Updated', value: `${fromNow(new Date(updatedAt))} ago` });
  } else {
    fields.push({ label: '', value: 'None assigned yet' });
  }
  fields.push({ label: '', value: '' });
}

function displayApplePushKey(
  maybePushKey: ApplePushKeyFragment | null,
  fields: { label: string; value: string }[]
): void {
  fields.push({ label: 'Push Key', value: '' });
  if (maybePushKey) {
    const { keyIdentifier, appleTeam, updatedAt } = maybePushKey;
    fields.push({ label: 'Developer Portal ID', value: keyIdentifier });
    if (appleTeam) {
      const { appleTeamIdentifier, appleTeamName } = appleTeam;
      fields.push({
        label: 'Apple Team',
        value: `${appleTeamIdentifier} ${appleTeamName ? `(${appleTeamName})` : ''}`,
      });
    }
    fields.push({ label: 'Updated', value: `${fromNow(new Date(updatedAt))} ago` });
  } else {
    fields.push({ label: '', value: 'None assigned yet' });
  }
  fields.push({ label: '', value: '' });
}

function displayAscApiKey(
  maybeAscApiKey: AppStoreConnectApiKeyFragment | null,
  fields: { label: string; value: string }[]
): void {
  fields.push({ label: 'App Store Connect API Key', value: '' });
  if (maybeAscApiKey) {
    const { keyIdentifier, issuerIdentifier, appleTeam, name, roles, updatedAt } = maybeAscApiKey;
    fields.push({ label: 'Developer Portal ID', value: keyIdentifier });
    if (name) {
      fields.push({ label: 'Name', value: name });
    }
    fields.push({ label: 'Issuer ID', value: issuerIdentifier });
    if (roles) {
      fields.push({ label: 'Roles', value: roles.join(',') });
    }
    if (appleTeam) {
      const { appleTeamIdentifier, appleTeamName } = appleTeam;
      fields.push({
        label: 'Apple Team',
        value: `${appleTeamIdentifier} ${appleTeamName ? `(${appleTeamName})` : ''}`,
      });
    }
    fields.push({ label: 'Updated', value: `${fromNow(new Date(updatedAt))} ago` });
  } else {
    fields.push({ label: '', value: 'None assigned yet' });
  }
  fields.push({ label: '', value: '' });
}

function formatAppleDevice(device: AppleDeviceFragment): string {
  let deviceString = '';
  if (device.name) {
    deviceString += device.name;
  }
  if (device.deviceClass || device.model) {
    const deviceDetails = [
      device.deviceClass && APPLE_DEVICE_CLASS_LABELS[device.deviceClass],
      device.model,
    ]
      .filter(i => i)
      .join(' ');
    if (deviceString === '') {
      deviceString += deviceDetails;
    } else {
      deviceString += ` - ${deviceDetails}`;
    }
  }

  if (deviceString === '') {
    deviceString += device.identifier;
  } else {
    deviceString += ` (UDID: ${device.identifier})`;
  }
  return deviceString;
}
