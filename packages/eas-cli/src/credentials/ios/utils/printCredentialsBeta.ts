import chalk from 'chalk';
import dateformat from 'dateformat';

import {
  CommonIosAppCredentialsFragment,
  IosAppBuildCredentialsFragment,
  IosDistributionType,
} from '../../../graphql/generated';
import Log from '../../../log';
import { fromNow } from '../../../utils/date';
import { AppLookupParams } from '../api/GraphqlClient';

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
  iosAppBuildCredentialsArray: IosAppBuildCredentialsFragment[]
): IosAppBuildCredentialsFragment[] {
  // The order in which we choose the distribution type from least to most preferred
  const typePriority = [
    IosDistributionType.Development,
    IosDistributionType.AdHoc,
    IosDistributionType.Enterprise,
    IosDistributionType.AppStore,
  ];
  return iosAppBuildCredentialsArray
    .sort(
      (buildCredentialsA, buildCredentialsB) =>
        typePriority.indexOf(buildCredentialsA.iosDistributionType) -
        typePriority.indexOf(buildCredentialsB.iosDistributionType)
    )
    .reverse();
}

export function displayIosAppCredentials(credentials: CommonIosAppCredentialsFragment): void {
  Log.log(chalk.bold(`iOS Credentials`));
  Log.log(`  Project: ${credentials.app.fullName}`);
  Log.log(`  Bundle Identifier: ${credentials.appleAppIdentifier.bundleIdentifier}`);
  const appleTeam = credentials.appleTeam;
  if (appleTeam) {
    const { appleTeamIdentifier, appleTeamName } = appleTeam;
    Log.log(`  Apple Team: ${appleTeamIdentifier} ${appleTeamName ? `(${appleTeamName})` : ''}`);
  }
  Log.newLine();

  if (credentials.iosAppBuildCredentialsArray.length === 0) {
    Log.log(`  Configuration: None setup yet`);
    Log.newLine();
    return;
  }
  const sortedIosAppBuildCredentialsArray = sortBuildCredentialsByDistributionType(
    credentials.iosAppBuildCredentialsArray
  );
  for (const iosAppBuildCredentials of sortedIosAppBuildCredentialsArray) {
    displayIosAppBuildCredentials(iosAppBuildCredentials);
  }
}

function displayIosAppBuildCredentials(buildCredentials: IosAppBuildCredentialsFragment): void {
  Log.log(
    chalk.bold(
      `  Configuration: ${prettyIosDistributionType(buildCredentials.iosDistributionType)}`
    )
  );
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
    const { expiration, updatedAt, status, developerPortalIdentifier, appleTeam } = maybeProvProf;
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
    Log.log(`    Updated ${fromNow(new Date(updatedAt))} ago`);
  } else {
    Log.log(`    None assigned yet`);
  }
  Log.newLine();
}
