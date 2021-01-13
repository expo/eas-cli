import chalk from 'chalk';
import dateformat from 'dateformat';

import {
  CommonIosAppCredentialsFragment,
  IosAppBuildCredentialsFragment,
  IosDistributionType,
} from '../../../graphql/generated';
import log from '../../../log';
import { fromNow } from '../../../utils/date';
import { AppLookupParams } from '../api/GraphqlClient';

export function prettyIosDistributionType(distributionType: IosDistributionType): string {
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
  log(chalk.bold(`iOS Credentials`));
  log(`  Project: ${projectName}`);
  log(`  Bundle Identifier: ${bundleIdentifier}`);
  log(`  No credentials set up yet!`);
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
  log(chalk.bold(`iOS Credentials`));
  log(`  Project: ${credentials.app.fullName}`);
  log(`  Bundle Identifier: ${credentials.appleAppIdentifier.bundleIdentifier}`);
  const appleTeam = credentials.appleTeam;
  if (appleTeam) {
    const { appleTeamIdentifier, appleTeamName } = appleTeam;
    log(`  Apple Team: ${appleTeamIdentifier} ${appleTeamName ? `(${appleTeamName})` : ''}`);
  }
  log.newLine();

  if (credentials.iosAppBuildCredentialsArray.length === 0) {
    log(`  Configuration: None setup yet`);
    log.newLine();
    return;
  }
  const sortedIosAppBuildCredentialsArray = sortBuildCredentialsByDistributionType(
    credentials.iosAppBuildCredentialsArray
  );
  for (const iosAppBuildCredentials of sortedIosAppBuildCredentialsArray) {
    displayIosAppBuildCredentials(iosAppBuildCredentials);
  }
}

export function displayIosAppBuildCredentials(
  buildCredentials: IosAppBuildCredentialsFragment
): void {
  log(
    chalk.bold(
      `  Configuration: ${prettyIosDistributionType(buildCredentials.iosDistributionType)}`
    )
  );
  const maybeDistCert = buildCredentials.distributionCertificate;
  log(`  Distribution Certificate:`);
  if (maybeDistCert) {
    const { serialNumber, updatedAt, validityNotAfter, appleTeam } = maybeDistCert;
    log(`    Serial Number: ${serialNumber}`);
    log(`    Expiration Date: ${dateformat(validityNotAfter, 'expiresHeaderFormat')}`);
    if (appleTeam) {
      const { appleTeamIdentifier, appleTeamName } = appleTeam;
      log(`    Apple Team: ${appleTeamIdentifier} ${appleTeamName ? `(${appleTeamName})` : ''}`);
    }
    log(`    Updated ${fromNow(new Date(updatedAt))} ago`);
  } else {
    log(`    None assigned yet`);
  }
  log.newLine();

  const maybeProvProf = buildCredentials.provisioningProfile;
  log(`  Provisioning Profile:`);
  if (maybeProvProf) {
    const { expiration, updatedAt, status, developerPortalIdentifier, appleTeam } = maybeProvProf;
    if (developerPortalIdentifier) {
      log(`    Developer Portal ID: ${developerPortalIdentifier}`);
    }
    log(`    Status: ${status}`);
    log(`    Expiration Date: ${dateformat(expiration, 'expiresHeaderFormat')}`);
    if (appleTeam) {
      const { appleTeamIdentifier, appleTeamName } = appleTeam;
      log(`    Apple Team: ${appleTeamIdentifier} ${appleTeamName ? `(${appleTeamName})` : ''}`);
    }
    log(`    Updated ${fromNow(new Date(updatedAt))} ago`);
  } else {
    log(`    None assigned yet`);
  }
  log.newLine();
}
