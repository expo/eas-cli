import fs from 'fs-extra';
import zipObject from 'lodash/zipObject';
import nullthrows from 'nullthrows';
import path from 'path';

import { IosDistributionType } from '../../graphql/generated';
import Log from '../../log';
import { findApplicationTarget, findTargetByName } from '../../project/ios/target';
import { getProjectAccountName } from '../../project/projectUtils';
import { confirmAsync } from '../../prompts';
import { gitStatusAsync } from '../../utils/git';
import { Context } from '../context';
import { App, Target, TargetCredentials } from '../ios/types';
import { readRawAsync } from './read';
import {
  CredentialsJson,
  CredentialsJsonIosCredentials,
  CredentialsJsonIosTargetCredentials,
} from './types';
import { getCredentialsJsonPath } from './utils';

/**
 * Update Android credentials.json with values from www, content of credentials.json
 * is not validated
 */
export async function updateAndroidCredentialsAsync(ctx: Context): Promise<void> {
  const rawCredentialsJson: any =
    (await readRawAsync(ctx.projectDir, { throwIfMissing: false })) ?? {};

  const accountName = getProjectAccountName(ctx.exp, ctx.user);
  const experienceName = `@${accountName}/${ctx.exp.slug}`;
  const keystore = await ctx.android.fetchKeystoreAsync(experienceName);
  if (!keystore) {
    throw new Error('There are no credentials configured for this project on EAS servers');
  }

  const isKeystoreComplete =
    keystore.keystore && keystore.keystorePassword && keystore.keyPassword && keystore.keyAlias;

  if (!isKeystoreComplete) {
    const confirm = await confirmAsync({
      message:
        'Credentials on EAS servers might be invalid or incomplete. Are you sure you want to continue?',
    });
    if (!confirm) {
      Log.warn('Aborting...');
      return;
    }
  }

  const keystorePath =
    rawCredentialsJson?.android?.keystore?.keystorePath ?? 'credentials/android/keystore.jks';
  Log.log(`Writing Keystore to ${keystorePath}`);
  await updateFileAsync(ctx.projectDir, keystorePath, keystore.keystore);
  const shouldWarnKeystore = await isFileUntrackedAsync(keystorePath);

  const androidCredentials: Partial<CredentialsJson['android']> = {
    keystore: {
      keystorePath,
      keystorePassword: keystore.keystorePassword,
      keyAlias: keystore.keyAlias,
      keyPassword: keystore.keyPassword,
    },
  };
  rawCredentialsJson.android = androidCredentials;
  await fs.writeJson(getCredentialsJsonPath(ctx.projectDir), rawCredentialsJson, {
    spaces: 2,
  });
  const shouldWarnCredentialsJson = await isFileUntrackedAsync('credentials.json');

  const newFilePaths = [];
  if (shouldWarnKeystore) {
    newFilePaths.push(keystorePath);
  }
  if (shouldWarnCredentialsJson) {
    newFilePaths.push('credentials.json');
  }
  displayUntrackedFilesWarning(newFilePaths);
}

/**
 * Update iOS credentials in credentials.json with values from www, contents
 * of credentials.json are not validated, if www has incomplete credentials
 * credentials.json will be updated partially
 */
export async function updateIosCredentialsAsync(
  ctx: Context,
  app: App,
  targets: Target[],
  distributionType: IosDistributionType
): Promise<void> {
  const rawCredentialsJson: any =
    (await readRawAsync(ctx.projectDir, { throwIfMissing: false })) ?? {};
  if (typeof rawCredentialsJson.ios?.provisioningProfilePath === 'string') {
    const applicationTarget = findApplicationTarget(targets);
    rawCredentialsJson.ios = {
      [applicationTarget.targetName]: rawCredentialsJson.ios,
    };
  }

  const targetBuildCredentialsList = await Promise.all(
    targets.map(target => getTargetBuildCredentialsAsync(ctx, app, target, distributionType))
  );
  const targetBuildsCredentialsMap = zipObject(
    targets.map(({ targetName }) => targetName),
    targetBuildCredentialsList
  );

  let areAllTargetsConfigured = true;
  const notConfiguredTargetLabels: string[] = [];
  for (const [targetName, targetAppBuildCredentials] of Object.entries(
    targetBuildsCredentialsMap
  )) {
    if (!targetAppBuildCredentials) {
      areAllTargetsConfigured = false;
      const { bundleIdentifier } = findTargetByName(targets, targetName);
      notConfiguredTargetLabels.push(`${targetName} (Bundle Identifier: ${bundleIdentifier})`);
    }
  }

  if (!areAllTargetsConfigured) {
    throw new Error(
      `Some of the build targets don't have credentials configured for the ${distributionType} distribution of this project are not on EAS servers: ${notConfiguredTargetLabels}`
    );
  }

  const iosCredentials: CredentialsJsonIosCredentials = {};
  for (const target of targets) {
    iosCredentials[target.targetName] = await updateIosTargetCredentialsAsync(
      ctx,
      target,
      // app build credentials must exist for target because otherwise an error must have been thrown earlier
      nullthrows(targetBuildsCredentialsMap[target.targetName]),
      rawCredentialsJson.ios?.[target.targetName]
    );
  }

  if (Object.keys(iosCredentials).length === 1) {
    rawCredentialsJson.ios = iosCredentials[Object.keys(iosCredentials)[0]];
  } else {
    rawCredentialsJson.ios = iosCredentials;
  }

  await fs.writeJson(getCredentialsJsonPath(ctx.projectDir), rawCredentialsJson, {
    spaces: 2,
  });

  const newFilePaths = [];
  for (const [, targetCredentials] of Object.entries(iosCredentials)) {
    if (await isFileUntrackedAsync(targetCredentials.distributionCertificate.path)) {
      newFilePaths.push(targetCredentials.distributionCertificate.path);
    }
    if (await isFileUntrackedAsync(targetCredentials.provisioningProfilePath)) {
      newFilePaths.push(targetCredentials.provisioningProfilePath);
    }
  }
  if (await isFileUntrackedAsync('credentials.json')) {
    newFilePaths.push('credentials.json');
  }
  displayUntrackedFilesWarning(newFilePaths);
}

async function getTargetBuildCredentialsAsync(
  ctx: Context,
  app: App,
  target: Target,
  iosDistributionType: IosDistributionType
): Promise<TargetCredentials | null> {
  const appCredentials = await ctx.ios.getIosAppCredentialsWithCommonFieldsAsync({
    account: app.account,
    projectName: app.projectName,
    bundleIdentifier: target.bundleIdentifier,
    parentBundleIdentifier: target.parentBundleIdentifier,
  });
  const appBuildCredentials =
    appCredentials?.iosAppBuildCredentialsList.find(
      appBuildCredentials => appBuildCredentials.iosDistributionType === iosDistributionType
    ) ?? null;
  if (appBuildCredentials === null) {
    return null;
  }
  if (
    !(
      appBuildCredentials.provisioningProfile?.provisioningProfile !== undefined &&
      appBuildCredentials.distributionCertificate?.certificateP12 !== undefined &&
      appBuildCredentials.distributionCertificate?.certificatePassword !== undefined
    )
  ) {
    return null;
  }
  return {
    distributionCertificate: {
      certificateP12: nullthrows(appBuildCredentials.distributionCertificate.certificateP12),
      certificatePassword: nullthrows(
        appBuildCredentials.distributionCertificate.certificatePassword
      ),
    },
    provisioningProfile: nullthrows(appBuildCredentials.provisioningProfile.provisioningProfile),
  };
}

async function updateIosTargetCredentialsAsync(
  ctx: Context,
  target: Target,
  targetCredentials: TargetCredentials,
  currentRawTargetCredentialsObject?: any
): Promise<CredentialsJsonIosTargetCredentials> {
  const provisioningProfilePath: string =
    currentRawTargetCredentialsObject?.provisioningProfilePath ??
    `credentials/ios/${target.targetName}-profile.mobileprovision`;
  const distCertPath: string =
    currentRawTargetCredentialsObject?.distributionCertificate?.path ??
    `credentials/ios/${target.targetName}-dist-cert.p12`;

  Log.log(`Writing Provisioning Profile to ${provisioningProfilePath}`);
  await updateFileAsync(
    ctx.projectDir,
    provisioningProfilePath,
    targetCredentials.provisioningProfile
  );

  Log.log(`Writing Distribution Certificate to ${distCertPath}`);
  await updateFileAsync(
    ctx.projectDir,
    distCertPath,
    targetCredentials.distributionCertificate.certificateP12
  );

  return {
    distributionCertificate: {
      path: distCertPath,
      password: targetCredentials.distributionCertificate.certificatePassword,
    },
    provisioningProfilePath,
  };
}

async function updateFileAsync(
  projectDir: string,
  filePath: string,
  base64Data?: string
): Promise<void> {
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(projectDir, filePath);
  if (await fs.pathExists(absolutePath)) {
    await fs.remove(absolutePath);
  }
  if (base64Data) {
    await fs.mkdirp(path.dirname(filePath));
    await fs.writeFile(filePath, Buffer.from(base64Data, 'base64'));
  }
}

async function isFileUntrackedAsync(path: string): Promise<boolean> {
  const withUntrackedFiles = await gitStatusAsync({ showUntracked: true });
  const trackedFiles = await gitStatusAsync({ showUntracked: false });
  const pathWithoutLeadingDot = path.replace(/^\.\//, ''); // remove leading './' from path
  return (
    withUntrackedFiles.includes(pathWithoutLeadingDot) &&
    !trackedFiles.includes(pathWithoutLeadingDot)
  );
}

function displayUntrackedFilesWarning(newFilePaths: string[]) {
  if (newFilePaths.length === 1) {
    Log.warn(
      `File ${newFilePaths[0]} is currently untracked, remember to add it to .gitignore, or to encrypt it (e.g. with git-crypt).`
    );
  } else if (newFilePaths.length > 1) {
    Log.warn(
      `Files ${newFilePaths.join(
        ', '
      )} are currently untracked, remember to add them to .gitignore, or to encrypt them (e.g. with git-crypt).`
    );
  }
}
