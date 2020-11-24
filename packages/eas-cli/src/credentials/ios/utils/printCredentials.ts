import chalk from 'chalk';

import {
  APPLE_DEVICE_CLASS_LABELS,
  AppleDevice,
} from '../../../graphql/types/credentials/AppleDevice';
import log from '../../../log';
import {
  AppLookupParams,
  IosAppCredentials,
  IosCredentials,
  IosDistCredentials,
  IosPushCredentials,
} from '../credentials';

export function displayProjectCredentials(
  appLookupParams: AppLookupParams,
  appCredentials?: IosAppCredentials | null,
  pushKey?: IosPushCredentials | null,
  distCert?: IosDistCredentials | null
): void {
  const experienceName = `@${appLookupParams.accountName}/${appLookupParams.projectName}`;
  const bundleIdentifier = appLookupParams.bundleIdentifier;
  if (!appCredentials) {
    log(
      chalk.bold(
        `No credentials configured for app ${experienceName} with bundle identifier ${bundleIdentifier}\n`
      )
    );
    return;
  }

  log();
  log(chalk.bold('Project Credentials Configuration:'));
  displayIosAppCredentials(appCredentials);
  log();

  if (distCert) {
    displayIosUserCredentials(distCert);
  }

  if (pushKey) {
    displayIosUserCredentials(pushKey);
  }
}

export async function displayAllIosCredentials(credentials: IosCredentials) {
  log(chalk.bold('Available credentials for iOS apps'));
  log.newLine();

  log(chalk.bold('Application credentials'));
  log.newLine();
  for (const cred of credentials.appCredentials) {
    displayIosAppCredentials(cred);
    log();
  }

  log(chalk.bold('User credentials\n'));
  for (const cred of credentials.userCredentials) {
    displayIosUserCredentials(cred, credentials);
    log.newLine();
  }
  log.newLine();
}

export function displayIosAppCredentials(appCredentials: IosAppCredentials) {
  log(
    `  Project: ${chalk.bold(appCredentials.experienceName)}, bundle identifier: ${
      appCredentials.bundleIdentifier
    }`
  );
  if (appCredentials.credentials.provisioningProfile) {
    log(
      `    Provisioning profile (ID: ${chalk.green(
        appCredentials.credentials.provisioningProfileId || '---------'
      )})`
    );
  } else {
    log('    Provisioning profile is missing. It will be generated during the next build');
  }
  if (appCredentials.credentials.devices && appCredentials.credentials.devices.length > 0) {
    log(`    Provisioned devices:`);
    for (const device of appCredentials.credentials.devices) {
      log(`    - ${formatDevice(device)}`);
    }
  }
  if (appCredentials.credentials.teamId || appCredentials.credentials.teamName) {
    log(
      `    Apple Team ID: ${chalk.green(
        appCredentials.credentials.teamId || '---------'
      )},  Apple Team Name: ${chalk.green(appCredentials.credentials.teamName || '---------')}`
    );
  }
  if (appCredentials.credentials.pushP12 && appCredentials.credentials.pushPassword) {
    log(
      `    (deprecated) Push Certificate (Push ID: ${chalk.green(
        appCredentials.credentials.pushId || '-----'
      )})`
    );
  }
}

function formatDevice(device: AppleDevice): string {
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

export function displayIosUserCredentials(
  userCredentials: IosPushCredentials | IosDistCredentials,
  credentials?: IosCredentials
) {
  if (userCredentials.type === 'push-key') {
    log(`  Push Notifications Key - Key ID: ${chalk.green(userCredentials.apnsKeyId)}`);
  } else if (userCredentials.type === 'dist-cert') {
    log(
      `  Distribution Certificate - Certificate ID: ${chalk.green(
        userCredentials.certId || '-----'
      )}`
    );
  } else {
    log.warn(`  Unknown key type ${(userCredentials as any).type}`);
  }
  log(
    `    Apple Team ID: ${chalk.green(
      userCredentials.teamId || '---------'
    )},  Apple Team Name: ${chalk.green(userCredentials.teamName || '---------')}`
  );

  if (credentials) {
    const field = userCredentials.type === 'push-key' ? 'pushCredentialsId' : 'distCredentialsId';
    const usedByApps = [
      ...new Set(
        credentials.appCredentials
          .filter(c => c[field] === userCredentials.id)
          .map(c => `${c.experienceName} (${c.bundleIdentifier})`)
      ),
    ].join(',\n      ');
    const usedByAppsText = usedByApps ? `used by\n      ${usedByApps}` : 'not used by any apps';
    log(`    ${chalk.gray(usedByAppsText)}`);
  }
}
