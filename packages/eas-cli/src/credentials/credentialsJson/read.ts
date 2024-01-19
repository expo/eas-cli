import { Ios } from '@expo/eas-build-job';
import fs from 'fs-extra';
import path from 'path';

import {
  AndroidCredentials,
  CredentialsJson,
  CredentialsJsonIosTargetCredentials,
  CredentialsJsonSchema,
} from './types';
import { getCredentialsJsonPath } from './utils';
import { Target } from '../ios/types';

export async function readAndroidCredentialsAsync(projectDir: string): Promise<AndroidCredentials> {
  const credentialsJson = await readAsync(projectDir);
  if (!credentialsJson.android) {
    throw new Error('Android credentials are missing in credentials.json');
  }
  const keystoreInfo = credentialsJson.android.keystore;
  return {
    keystore: {
      keystore: await fs.readFile(getAbsolutePath(projectDir, keystoreInfo.keystorePath), 'base64'),
      keystorePassword: keystoreInfo.keystorePassword,
      keyAlias: keystoreInfo.keyAlias,
      keyPassword: keystoreInfo.keyPassword,
    },
  };
}

export async function readIosCredentialsAsync(
  projectDir: string,
  applicationTarget: Target
): Promise<Ios.BuildCredentials> {
  const credentialsJson = await readAsync(projectDir);
  if (!credentialsJson.ios) {
    throw new Error('iOS credentials are missing in credentials.json');
  }

  if (isCredentialsMap(credentialsJson.ios)) {
    const targets = Object.keys(credentialsJson.ios);
    const iosCredentials: Ios.BuildCredentials = {};
    for (const target of targets) {
      iosCredentials[target] = await readCredentialsForTargetAsync(
        projectDir,
        credentialsJson.ios[target]
      );
    }
    return iosCredentials;
  } else {
    const applicationTargetCredentials = await readCredentialsForTargetAsync(
      projectDir,
      credentialsJson.ios
    );
    return {
      [applicationTarget.targetName]: applicationTargetCredentials,
    };
  }
}

function isCredentialsMap(
  ios: Exclude<CredentialsJson['ios'], undefined>
): ios is Record<string, CredentialsJsonIosTargetCredentials> {
  return typeof ios.provisioningProfilePath !== 'string';
}

async function readCredentialsForTargetAsync(
  projectDir: string,
  targetCredentials: CredentialsJsonIosTargetCredentials
): Promise<Ios.TargetCredentials> {
  return {
    provisioningProfileBase64: await fs.readFile(
      getAbsolutePath(projectDir, targetCredentials.provisioningProfilePath),
      'base64'
    ),
    provisioningProfileType:
      path.extname(targetCredentials.provisioningProfilePath) === 'provisionprofile'
        ? Ios.ProvisioningProfileType.PROVISIONPROFILE
        : Ios.ProvisioningProfileType.MOBILEPROVISION,
    distributionCertificate: {
      dataBase64: await fs.readFile(
        getAbsolutePath(projectDir, targetCredentials.distributionCertificate.path),
        'base64'
      ),
      password: targetCredentials.distributionCertificate.password,
    },
  };
}

async function readAsync(projectDir: string): Promise<CredentialsJson> {
  const credentialsJSONRaw = await readRawAsync(projectDir);

  const { value: credentialsJson, error } = CredentialsJsonSchema.validate(credentialsJSONRaw, {
    stripUnknown: true,
    convert: true,
    abortEarly: false,
  });
  if (error) {
    throw new Error(`credentials.json is not valid [${error.toString()}]`);
  }

  return credentialsJson;
}

export async function readRawAsync(
  projectDir: string,
  { throwIfMissing = true } = {}
): Promise<any> {
  const credentialsJsonFilePath = getCredentialsJsonPath(projectDir);
  if (!(await fs.pathExists(credentialsJsonFilePath))) {
    if (throwIfMissing) {
      throw new Error('credentials.json does not exist in the project root directory');
    } else {
      return null;
    }
  }
  try {
    const credentialsJSONContents = await fs.readFile(credentialsJsonFilePath, 'utf8');
    return JSON.parse(credentialsJSONContents);
  } catch {
    throw new Error(
      `credentials.json must exist in the project root directory and contain a valid JSON`
    );
  }
}

function getAbsolutePath(projectDir: string, filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.join(projectDir, filePath);
}
