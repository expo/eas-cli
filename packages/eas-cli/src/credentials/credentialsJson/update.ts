import fs from 'fs-extra';
import path from 'path';

import log from '../../log';
import { getProjectAccountName } from '../../project/projectUtils';
import { confirmAsync } from '../../prompts';
import { gitStatusAsync } from '../../utils/git';
import { Context } from '../context';
import { CredentialsJson } from './read';

/**
 * Update Android credentials.json with values from www, content of credentials.json
 * is not validated
 */
export async function updateAndroidCredentialsAsync(ctx: Context): Promise<void> {
  const credentialsJsonFilePath = path.join(ctx.projectDir, 'credentials.json');
  let rawCredentialsJsonObject: any = {};
  if (await fs.pathExists(credentialsJsonFilePath)) {
    try {
      // reading raw file without validation (used only to access keystorePath)
      const rawFile = await fs.readFile(credentialsJsonFilePath, 'utf-8');
      rawCredentialsJsonObject = JSON.parse(rawFile);
    } catch (error) {
      log.error(`Reading credentials.json failed [${error}]`);
      log.error('Make sure that file is correct (or remove it) and rerun this command.');
      throw error;
    }
  }
  const accountName = await getProjectAccountName(ctx.exp, ctx.user);
  const experienceName = `@${accountName}/${ctx.exp.slug}`;
  const keystore = await ctx.android.fetchKeystoreAsync(experienceName);
  if (!keystore) {
    throw new Error('There are no credentials configured for this project on Expo servers');
  }

  const isKeystoreComplete =
    keystore.keystore && keystore.keystorePassword && keystore.keyPassword && keystore.keyAlias;

  if (!isKeystoreComplete) {
    const confirm = await confirmAsync({
      message:
        'Credentials on Expo servers might be invalid or incomplete. Are you sure you want to continue?',
    });
    if (!confirm) {
      log.warn('Aborting...');
      return;
    }
  }

  const keystorePath =
    rawCredentialsJsonObject?.android?.keystore?.keystorePath ?? 'android/keystores/keystore.jks';
  log(`Writing Keystore to ${keystorePath}`);
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
  rawCredentialsJsonObject.android = androidCredentials;
  await fs.writeJson(credentialsJsonFilePath, rawCredentialsJsonObject, {
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
 * Update iOS credentials in credentials.json with values from www, content
 * of credentials.json is not validated, if www has incomplete credentials
 * credentials.json will be updated partially
 */
export async function updateIosCredentialsAsync(
  ctx: Context,
  bundleIdentifier: string
): Promise<void> {
  const credentialsJsonFilePath = path.join(ctx.projectDir, 'credentials.json');
  let rawCredentialsJsonObject: any = {};
  if (await fs.pathExists(credentialsJsonFilePath)) {
    try {
      // reading raw file without validation (used only to access paths)
      const rawFile = await fs.readFile(credentialsJsonFilePath, 'utf-8');
      rawCredentialsJsonObject = JSON.parse(rawFile);
    } catch (error) {
      log.error(`There was an error while reading credentials.json [${error}]`);
      log.error('Make sure that file is correct (or remove it) and rerun this command.');
      throw error;
    }
  }

  const accountName = await getProjectAccountName(ctx.exp, ctx.user);
  const appLookupParams = {
    accountName,
    projectName: ctx.exp.slug,
    bundleIdentifier,
  };
  const profilePath =
    rawCredentialsJsonObject?.ios?.provisioningProfilePath ?? 'ios/certs/profile.mobileprovision';
  const distCertPath =
    rawCredentialsJsonObject?.ios?.distributionCertificate?.path ?? 'ios/certs/dist-cert.p12';
  const appCredentials = await ctx.ios.getAppCredentialsAsync(appLookupParams);
  const distCredentials = await ctx.ios.getDistributionCertificateAsync(appLookupParams);
  if (!appCredentials?.credentials?.provisioningProfile && !distCredentials) {
    throw new Error('There are no credentials configured for this project on Expo servers');
  }

  const areCredentialsComplete =
    appCredentials?.credentials?.provisioningProfile &&
    distCredentials?.certP12 &&
    distCredentials?.certPassword;

  if (!areCredentialsComplete) {
    const confirm = await confirmAsync({
      message:
        'Credentials on Expo servers might be invalid or incomplete. Are you sure you want to continue?',
    });
    if (!confirm) {
      log.warn('Aborting...');
      return;
    }
  }

  log(`Writing Provisioning Profile to ${profilePath}`);
  await updateFileAsync(
    ctx.projectDir,
    profilePath,
    appCredentials?.credentials?.provisioningProfile
  );
  const shouldWarnPProfile = await isFileUntrackedAsync(profilePath);

  log(`Writing Distribution Certificate to ${distCertPath}`);
  await updateFileAsync(ctx.projectDir, distCertPath, distCredentials?.certP12);
  const shouldWarnDistCert = await isFileUntrackedAsync(distCertPath);

  const iosCredentials: Partial<CredentialsJson['ios']> = {
    ...(appCredentials?.credentials?.provisioningProfile
      ? { provisioningProfilePath: profilePath }
      : {}),
    ...(distCredentials?.certP12 && distCredentials?.certPassword
      ? {
          distributionCertificate: {
            path: distCertPath,
            password: distCredentials?.certPassword,
          },
        }
      : {}),
  };
  rawCredentialsJsonObject.ios = iosCredentials;
  await fs.writeJson(credentialsJsonFilePath, rawCredentialsJsonObject, {
    spaces: 2,
  });
  const shouldWarnCredentialsJson = await isFileUntrackedAsync('credentials.json');

  const newFilePaths = [];
  if (shouldWarnPProfile) {
    newFilePaths.push(profilePath);
  }
  if (shouldWarnDistCert) {
    newFilePaths.push(distCertPath);
  }
  if (shouldWarnCredentialsJson) {
    newFilePaths.push('credentials.json');
  }
  displayUntrackedFilesWarning(newFilePaths);
}

async function updateFileAsync(projectDir: string, filePath: string, base64Data?: string) {
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
    log.warn(
      `File ${newFilePaths[0]} is currently untracked, remember to add it to .gitignore or to encrypt it. (e.g. with git-crypt)`
    );
  } else if (newFilePaths.length > 1) {
    log.warn(
      `Files ${newFilePaths.join(
        ', '
      )} are currently untracked, remember to add them to .gitignore or to encrypt them. (e.g. with git-crypt)`
    );
  }
}
