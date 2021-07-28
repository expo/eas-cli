import chalk from 'chalk';
import dateformat from 'dateformat';

import {
  AppleAppSpecificPasswordFragment,
  AppleDeviceFragment,
  ApplePushKeyFragment,
  IosAppBuildCredentialsFragment,
  IosDistributionType,
} from '../../../graphql/generated';
import { APPLE_DEVICE_CLASS_LABELS } from '../../../graphql/types/credentials/AppleDevice';
import Log from '../../../log';
import { fromNow } from '../../../utils/date';
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
  Log.log(chalk.bold(`iOS Credentials`));
  Log.log(`  Project: ${projectName}`);
  Log.log(`  Bundle Identifier: ${bundleIdentifier}`);
  Log.log(`  No credentials set up yet!`);
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

  Log.log(chalk.bold(`iOS Credentials`));
  Log.addNewLineIfNone();
  Log.log(`  Project: ${chalk.bold(projectFullName)}`);

  for (const { targetName, bundleIdentifier } of targets) {
    if (isMultitarget) {
      Log.newLine();
      Log.log(`  Target: ${chalk.bold(targetName)}`);
    }
    Log.log(`  Bundle Identifier: ${chalk.bold(bundleIdentifier)}`);
    const targetAppCredentials = appCredentialsMap[targetName];
    if (!targetAppCredentials) {
      Log.newLine();
      Log.log(`  No credentials set up yet!`);
      Log.newLine();
      continue;
    }

    const { appleTeam, pushKey, appSpecificPassword } = targetAppCredentials;
    if (appleTeam) {
      const { appleTeamIdentifier, appleTeamName } = appleTeam;
      Log.log(`  Apple Team: ${appleTeamIdentifier} ${appleTeamName ? `(${appleTeamName})` : ''}`);
    }
    Log.newLine();

    if (pushKey) {
      displayApplePushKey(pushKey);
    }

    if (appSpecificPassword) {
      displayAppSpecificPassword(appSpecificPassword);
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
  Log.log(chalk.bold('Project Credentials Configuration:'));
  Log.log(`  Project: ${chalk.bold(projectFullName)}`);
  for (const [targetName, buildCredentials] of Object.entries(appBuildCredentials)) {
    if (isMultitarget) {
      Log.newLine();
      Log.log(`  Target: ${chalk.bold(targetName)}`);
    }
    Log.log(`  Bundle Identifier: ${chalk.bold(targetToBundleId[targetName])}`);
    displayIosAppBuildCredentials(buildCredentials);
  }
}

function displayIosAppBuildCredentials(buildCredentials: IosAppBuildCredentialsFragment): void {
  Log.log(
    `  Configuration: ${chalk.bold(
      prettyIosDistributionType(buildCredentials.iosDistributionType)
    )}`
  );
  Log.newLine();
  const maybeDistCert = buildCredentials.distributionCertificate;
  Log.log(`  Distribution Certificate:`);
  if (maybeDistCert) {
    const { serialNumber, updatedAt, validityNotAfter, appleTeam } = maybeDistCert;
    Log.log(`    Serial Number: ${serialNumber}`);
    Log.log(`    Expiration Date: ${dateformat(validityNotAfter, 'expiresHeaderFormat')}`);
    if (appleTeam) {
      const { appleTeamIdentifier, appleTeamName } = appleTeam;
      Log.log(
        `    Apple Team: ${appleTeamIdentifier} ${appleTeamName ? `(${appleTeamName})` : ''}`
      );
    }
    Log.log(`    Updated ${fromNow(new Date(updatedAt))} ago`);
  } else {
    Log.log(`    None assigned yet`);
  }
  Log.newLine();

  const maybeProvProf = buildCredentials.provisioningProfile;
  Log.log(`  Provisioning Profile:`);
  if (maybeProvProf) {
    const { expiration, updatedAt, status, developerPortalIdentifier, appleTeam, appleDevices } =
      maybeProvProf;
    if (developerPortalIdentifier) {
      Log.log(`    Developer Portal ID: ${developerPortalIdentifier}`);
    }
    Log.log(`    Status: ${status}`);
    Log.log(`    Expiration Date: ${dateformat(expiration, 'expiresHeaderFormat')}`);
    if (appleTeam) {
      const { appleTeamIdentifier, appleTeamName } = appleTeam;
      Log.log(
        `    Apple Team: ${appleTeamIdentifier} ${appleTeamName ? `(${appleTeamName})` : ''}`
      );
    }
    if (appleDevices && appleDevices.length > 0) {
      Log.log(`    Provisioned devices:`);
      for (const appleDevice of appleDevices) {
        Log.log(`    - ${formatAppleDevice(appleDevice)}`);
      }
    }
    Log.log(`    Updated ${fromNow(new Date(updatedAt))} ago`);
  } else {
    Log.log(`    None assigned yet`);
  }
  Log.newLine();
}

function displayAppSpecificPassword(
  maybeAppSpecificPassword: AppleAppSpecificPasswordFragment | null
): void {
  Log.log(`  App Specific Password:`);
  if (maybeAppSpecificPassword) {
    const { appleIdUsername, passwordLabel, updatedAt } = maybeAppSpecificPassword;
    Log.log(`    Apple ID Username: ${appleIdUsername}`);
    if (passwordLabel) {
      Log.log(`    Password Label: ${passwordLabel}`);
    }
    Log.log(`    Updated ${fromNow(new Date(updatedAt))} ago`);
  } else {
    Log.log(`    None assigned yet`);
  }
  Log.newLine();
}

function displayApplePushKey(maybePushKey: ApplePushKeyFragment | null): void {
  Log.log(`  Push Key:`);
  if (maybePushKey) {
    const { keyIdentifier, appleTeam, updatedAt } = maybePushKey;
    Log.log(`    Developer Portal ID: ${keyIdentifier}`);
    if (appleTeam) {
      const { appleTeamIdentifier, appleTeamName } = appleTeam;
      Log.log(
        `    Apple Team: ${appleTeamIdentifier} ${appleTeamName ? `(${appleTeamName})` : ''}`
      );
    }
    Log.log(`    Updated ${fromNow(new Date(updatedAt))} ago`);
  } else {
    Log.log(`    None assigned yet`);
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
