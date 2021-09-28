import chalk from 'chalk';
import dateformat from 'dateformat';

import {
  AppleDeviceFragment,
  ApplePushKeyFragment,
  IosAppBuildCredentialsFragment,
  IosDistributionType,
} from '../../../graphql/generated';
import { APPLE_DEVICE_CLASS_LABELS } from '../../../graphql/types/credentials/AppleDevice';
import Log from '../../../log';
import { fromNow } from '../../../utils/date';
import formatFields from '../../../utils/formatFields';
import { AppLookupParams } from '../api/GraphqlClient';
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
  Log.log(formatFields(fields, { labelFormat: chalk.cyan.bold }));
  Log.log(
    formatFields([{ label: 'No credentials set up yet!', value: '' }])
  );
  Log.newLine();
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
  Log.log(formatFields(fields, { labelFormat: chalk.cyan.bold }));

  for (const { targetName, bundleIdentifier } of targets) {
    if (isMultitarget) {
      Log.newLine();
      Log.log(formatFields([{ label: 'Target', value: targetName }], { labelFormat: chalk.cyan.bold }));
    }
    Log.log(formatFields([{ label: 'Bundle Identifier', value: bundleIdentifier }], { labelFormat: chalk.cyan.bold }));
    const targetAppCredentials = appCredentialsMap[targetName];
    if (!targetAppCredentials) {
      Log.newLine();
      Log.log(
        formatFields([{ label: 'No credentials set up yet!', value: '' }])
      );
      Log.newLine();
      continue;
    }

    const { appleTeam, pushKey } = targetAppCredentials;
    if (appleTeam) {
      const { appleTeamIdentifier, appleTeamName } = appleTeam;
      Log.log(formatFields([{ label: 'Apple Team', value: `${appleTeamIdentifier} ${appleTeamName ? `(${appleTeamName})` : ''}` }], { labelFormat: chalk.cyan.bold }));
    }
    Log.newLine();

    if (pushKey) {
      displayApplePushKey(pushKey);
    }

    const sortedIosAppBuildCredentialsList = sortBuildCredentialsByDistributionType(
      targetAppCredentials.iosAppBuildCredentialsList
    );
    for (const iosAppBuildCredentials of sortedIosAppBuildCredentialsList) {
      displayIosAppBuildCredentials(iosAppBuildCredentials);
    }
  }
}

export function displayProjectCredentials(
  app: App,
  appBuildCredentials: IosAppBuildCredentialsMap,
  targets: Target[]
): void {
  const projectFullName = `@${app.account.name}/${app.projectName}`;
  const targetToBundleId = targets.reduce<Record<string, string>>((acc, target) => {
    acc[target.targetName] = target.bundleIdentifier;
    return acc;
  }, {});
  const isMultitarget = targets.length > 1;

  Log.addNewLineIfNone();
  const fields = [
    { label: 'Project Credentials Configuration', value: '' },
    { label: 'Project', value: projectFullName },
  ];
  Log.log(formatFields(fields, { labelFormat: chalk.cyan.bold }));

  for (const [targetName, buildCredentials] of Object.entries(appBuildCredentials)) {
    if (isMultitarget) {
      Log.newLine();
      Log.log(formatFields([{ label: 'Target', value: targetName }], { labelFormat: chalk.cyan.bold }));
    }
    Log.log(formatFields([{ label: 'Bundle Identifier', value: targetToBundleId[targetName] }], { labelFormat: chalk.cyan.bold }));
    displayIosAppBuildCredentials(buildCredentials);
  }
}

function displayIosAppBuildCredentials(buildCredentials: IosAppBuildCredentialsFragment): void {
  Log.log(formatFields([{ label: 'Configuration', value: prettyIosDistributionType(buildCredentials.iosDistributionType) }], { labelFormat: chalk.cyan.bold }));
  Log.newLine();
  const maybeDistCert = buildCredentials.distributionCertificate;
  Log.log(
    formatFields([{ label: 'Distribution Certificate', value: '' }], {
      labelFormat: chalk.cyan.bold,
    })
  );
  if (maybeDistCert) {
    const { serialNumber, updatedAt, validityNotAfter, appleTeam } = maybeDistCert;
    const fields = [
      { label: 'Serial Number', value: serialNumber },
      { label: 'Expiration Date', value: dateformat(validityNotAfter, 'expiresHeaderFormat') },
    ];
    if (appleTeam) {
      const { appleTeamIdentifier, appleTeamName } = appleTeam;
      fields.push({label:'Apple Team', value:  `${appleTeamIdentifier} ${appleTeamName ? `(${appleTeamName})` : ''}`});
    }
    fields.push({label:'Updated', value:  `${fromNow(new Date(updatedAt))} ago`});
    Log.log(formatFields(fields, { labelFormat: chalk.cyan.bold }));
  } else {
    Log.log(
      formatFields([{ label: '', value: 'None assigned yet' }])
    );
  }
  Log.newLine();

  const maybeProvProf = buildCredentials.provisioningProfile;
  Log.log(
    formatFields([{ label: 'Provisioning Profile', value: '' }], {
      labelFormat: chalk.cyan.bold,
    })
  );
  if (maybeProvProf) {
    const { expiration, updatedAt, status, developerPortalIdentifier, appleTeam, appleDevices } =
      maybeProvProf;
    const fields = [];
    if (developerPortalIdentifier) {
      fields.push({label:'Developer Portal ID', value:  developerPortalIdentifier});
    }
    fields.push({label:'Status', value:  status});
    fields.push({label:'Expiration', value:  dateformat(expiration, 'expiresHeaderFormat')});
    if (appleTeam) {
      const { appleTeamIdentifier, appleTeamName } = appleTeam;
      fields.push({label:'Apple Team', value:  `${appleTeamIdentifier} ${appleTeamName ? `(${appleTeamName})` : ''}`});
    }
    if (appleDevices && appleDevices.length > 0) {
      fields.push({label:'Provisioned devices', value:  ''});
      for (const appleDevice of appleDevices) {
        fields.push({label:'    -', value:  formatAppleDevice(appleDevice)});
      }
    }
    fields.push({label:'Updated', value:  `${fromNow(new Date(updatedAt))} ago`});
    Log.log(formatFields(fields, { labelFormat: chalk.cyan.bold }));
  } else {
    Log.log(
      formatFields([{ label: '', value: 'None assigned yet' }])
    );
  }
  Log.newLine();
}

function displayApplePushKey(maybePushKey: ApplePushKeyFragment | null): void {
  Log.log(
    formatFields([{ label: 'Push Key', value: '' }], {
      labelFormat: chalk.cyan.bold,
    })
  );
  if (maybePushKey) {
    const { keyIdentifier, appleTeam, updatedAt } = maybePushKey;
    const fields = [{label:'Developer Portal ID', value:  keyIdentifier}];
    if (appleTeam) {
      const { appleTeamIdentifier, appleTeamName } = appleTeam;
      fields.push({label:'Apple Team', value:  `${appleTeamIdentifier} ${appleTeamName ? `(${appleTeamName})` : ''}`});
    }
    fields.push({label:'Updated', value:  `${fromNow(new Date(updatedAt))} ago`});
    Log.log(formatFields(fields, { labelFormat: chalk.cyan.bold }));
  } else {
    Log.log(
      formatFields([{ label: '', value: 'None assigned yet' }])
    );
  }
  Log.newLine();
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
