import fs from 'fs-extra';
import nullthrows from 'nullthrows';
import path from 'path';

import { readRawAsync } from './read';
import {
  CredentialsJson,
  CredentialsJsonIosCredentials,
  CredentialsJsonIosTargetCredentials,
} from './types';
import { getCredentialsJsonPath } from './utils';
import { AndroidAppBuildCredentialsFragment, IosDistributionType } from '../../graphql/generated';
import Log from '../../log';
import { findApplicationTarget, findTargetByName } from '../../project/ios/target';
import zipObject from '../../utils/expodash/zipObject';
import GitClient from '../../vcs/clients/git';
import { Client } from '../../vcs/vcs';
import { CredentialsContext } from '../context';
import { App, Target, TargetCredentials } from '../ios/types';

/**
 * Update Android credentials.json with values from www, content of credentials.json
 * is not validated
 */
export async function updateAndroidCredentialsAsync(
  ctx: CredentialsContext,
  buildCredentials: AndroidAppBuildCredentialsFragment
): Promise<void> {
  const rawCredentialsJson: any =
    (await readRawAsync(ctx.projectDir, { throwIfMissing: false })) ?? {};

  const keystore = buildCredentials.androidKeystore;
  if (!keystore) {
    throw new Error('There are no credentials configured for this project on EAS servers');
  }

  const keystorePath =
    rawCredentialsJson?.android?.keystore?.keystorePath ?? 'credentials/android/keystore.jks';
  Log.log(`Writing Keystore to ${keystorePath}`);
  await updateFileAsync(ctx.projectDir, keystorePath, keystore.keystore);
  const shouldWarnKeystore = await isFileUntrackedAsync(keystorePath, ctx.vcsClient);

  const androidCredentials: Partial<CredentialsJson['android']> = {
    keystore: {
      keystorePath,
      keystorePassword: keystore.keystorePassword,
      keyAlias: keystore.keyAlias,
      keyPassword: keystore.keyPassword ?? undefined,
    },
  };
  rawCredentialsJson.android = androidCredentials;
  await fs.writeJson(getCredentialsJsonPath(ctx.projectDir), rawCredentialsJson, {
    spaces: 2,
  });
  const shouldWarnCredentialsJson = await isFileUntrackedAsync('credentials.json', ctx.vcsClient);

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
  ctx: CredentialsContext,
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
    const errorMessage =
      targets.length === 1
        ? `There are no credentials configured for the ${distributionType} distribution of this project on EAS servers`
        : `Some of the build targets don't have credentials configured for the ${distributionType} distribution of this project on EAS servers: ${notConfiguredTargetLabels}`;
    throw new Error(errorMessage);
  }

  const iosCredentials: CredentialsJsonIosCredentials = {};
  const targetCredentialsPathsMap = createTargetCredentialsPathsMap(
    targets,
    rawCredentialsJson.ios
  );
  for (const target of targets) {
    iosCredentials[target.targetName] = await backupTargetCredentialsAsync(ctx, {
      // app build credentials must exist for target because otherwise an error must have been thrown earlier
      targetCredentials: nullthrows(targetBuildsCredentialsMap[target.targetName]),
      targetCredentialsPaths: targetCredentialsPathsMap[target.targetName],
    });
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
    if (await isFileUntrackedAsync(targetCredentials.distributionCertificate.path, ctx.vcsClient)) {
      newFilePaths.push(targetCredentials.distributionCertificate.path);
    }
    if (await isFileUntrackedAsync(targetCredentials.provisioningProfilePath, ctx.vcsClient)) {
      newFilePaths.push(targetCredentials.provisioningProfilePath);
    }
  }
  if (await isFileUntrackedAsync('credentials.json', ctx.vcsClient)) {
    newFilePaths.push('credentials.json');
  }
  displayUntrackedFilesWarning(newFilePaths);
}

interface TargetCredentialsPaths {
  provisioningProfilePath: string;
  distCertPath: string;
}
type TargetCredentialsPathsMap = Record<string, TargetCredentialsPaths>;
function createTargetCredentialsPathsMap(
  targets: Target[],
  rawCredentialsJsonMap?: any
): TargetCredentialsPathsMap {
  const hasManyTargets = targets.length > 1;
  const paths: TargetCredentialsPathsMap = {};

  // 1. Create initial target credentials paths map
  for (const target of targets) {
    const rawTargetCredentialsJson = rawCredentialsJsonMap?.[target.targetName];
    const filePrefix = hasManyTargets ? `${target.targetName}-` : '';

    paths[target.targetName] = {
      provisioningProfilePath:
        rawTargetCredentialsJson?.provisioningProfilePath ??
        `credentials/ios/${filePrefix}profile.mobileprovision`,
      distCertPath:
        rawTargetCredentialsJson?.distributionCertificate?.path ??
        `credentials/ios/${filePrefix}dist-cert.p12`,
    };
  }

  // 2. Look for duplicates and prefix them with target names
  const deduplicatedPaths: TargetCredentialsPathsMap = {};
  const usedProfilePaths = new Set<string>();
  const usedDistCertPaths = new Set<string>();
  for (const [targetName, { provisioningProfilePath, distCertPath }] of Object.entries(paths)) {
    const newProvisioningProfilePath = usedProfilePaths.has(provisioningProfilePath)
      ? path.join(
          path.dirname(provisioningProfilePath),
          `${targetName}-${path.basename(provisioningProfilePath)}`
        )
      : provisioningProfilePath;
    usedProfilePaths.add(newProvisioningProfilePath);

    const newDistCertPath = usedDistCertPaths.has(distCertPath)
      ? path.join(path.dirname(distCertPath), `${targetName}-${path.basename(distCertPath)}`)
      : distCertPath;
    usedDistCertPaths.add(newDistCertPath);

    deduplicatedPaths[targetName] = {
      distCertPath: newDistCertPath,
      provisioningProfilePath: newProvisioningProfilePath,
    };
  }

  return deduplicatedPaths;
}

async function getTargetBuildCredentialsAsync(
  ctx: CredentialsContext,
  app: App,
  target: Target,
  iosDistributionType: IosDistributionType
): Promise<TargetCredentials | null> {
  const appCredentials = await ctx.ios.getIosAppCredentialsWithCommonFieldsAsync(
    ctx.graphqlClient,
    {
      account: app.account,
      projectName: app.projectName,
      bundleIdentifier: target.bundleIdentifier,
      parentBundleIdentifier: target.parentBundleIdentifier,
    }
  );
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

async function backupTargetCredentialsAsync(
  ctx: CredentialsContext,
  {
    targetCredentials,
    targetCredentialsPaths,
  }: {
    targetCredentials: TargetCredentials;
    targetCredentialsPaths: TargetCredentialsPaths;
  }
): Promise<CredentialsJsonIosTargetCredentials> {
  const { provisioningProfilePath, distCertPath } = targetCredentialsPaths;

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

async function isFileUntrackedAsync(path: string, vcsClient: Client): Promise<boolean> {
  if (vcsClient instanceof GitClient) {
    return await vcsClient.isFileUntrackedAsync(path);
  }
  return false;
}

function displayUntrackedFilesWarning(newFilePaths: string[]): void {
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
