import Joi from '@hapi/joi';
import fs from 'fs-extra';
import path from 'path';

import { Keystore } from '../android/credentials';

interface CredentialsJsonIosCredentials {
  provisioningProfilePath: string;
  distributionCertificate: {
    path: string;
    password: string;
  };
}
export interface CredentialsJson {
  android?: {
    keystore: {
      keystorePath: string;
      keystorePassword: string;
      keyAlias: string;
      keyPassword?: string;
    };
  };
  ios?: CredentialsJsonIosCredentials | Record<string, CredentialsJsonIosCredentials>;
  experimental?: {
    npmToken?: string;
  };
}

const IosTargetCredentials = Joi.object({
  provisioningProfilePath: Joi.string().required(),
  distributionCertificate: Joi.object({
    path: Joi.string().required(),
    password: Joi.string().required(),
  }).required(),
});

const CredentialsJsonSchema = Joi.object({
  android: Joi.object({
    keystore: Joi.object({
      keystorePath: Joi.string().required(),
      keystorePassword: Joi.string().required(),
      keyAlias: Joi.string().required(),
      keyPassword: Joi.string().required(),
    }).required(),
  }),
  ios: [
    IosTargetCredentials,
    Joi.object().pattern(Joi.string().required(), IosTargetCredentials.required()),
  ],
  experimental: Joi.object({
    npmToken: Joi.string(),
  }),
});

interface AndroidCredentials {
  keystore: Keystore;
}

export interface IosTargetCredentials {
  provisioningProfile: string;
  distributionCertificate: {
    certP12: string;
    certPassword: string;
  };
}
export type IosTargetCredentialsMap = Record<string, IosTargetCredentials>;
export type IosCredentials = IosTargetCredentials | IosTargetCredentialsMap;

export async function fileExistsAsync(projectDir: string): Promise<boolean> {
  return await fs.pathExists(path.join(projectDir, 'credentials.json'));
}

export async function readAndroidCredentialsAsync(projectDir: string): Promise<AndroidCredentials> {
  const credentialsJson = await readAsync(projectDir);
  if (!credentialsJson.android) {
    throw new Error('Android credentials are missing from credentials.json');
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

export async function readIosCredentialsAsync(projectDir: string): Promise<IosCredentials> {
  const credentialsJson = await readAsync(projectDir);
  if (!credentialsJson.ios) {
    throw new Error('iOS credentials are missing from credentials.json');
  }

  if (!isInternalCredentialsMap(credentialsJson.ios)) {
    return await readCredentialsForTargetAsync(projectDir, credentialsJson.ios);
  } else {
    const targets = Object.keys(credentialsJson.ios);
    const targetCredentialsMap: IosTargetCredentialsMap = {};
    for (const target of targets) {
      targetCredentialsMap[target] = await readCredentialsForTargetAsync(
        projectDir,
        credentialsJson.ios[target]
      );
    }
    return targetCredentialsMap;
  }
}

function isInternalCredentialsMap(
  ios: CredentialsJsonIosCredentials | Record<string, CredentialsJsonIosCredentials>
): ios is Record<string, CredentialsJsonIosCredentials> {
  return typeof ios.provisioningProfilePath !== 'string';
}

export function isCredentialsMap(ios: IosCredentials): ios is IosTargetCredentialsMap {
  return typeof ios.provisioningProfile !== 'string';
}

async function readCredentialsForTargetAsync(
  projectDir: string,
  targetCredentials: CredentialsJsonIosCredentials
): Promise<IosTargetCredentials> {
  return {
    provisioningProfile: await fs.readFile(
      getAbsolutePath(projectDir, targetCredentials.provisioningProfilePath),
      'base64'
    ),
    distributionCertificate: {
      certP12: await fs.readFile(
        getAbsolutePath(projectDir, targetCredentials.distributionCertificate.path),
        'base64'
      ),
      certPassword: targetCredentials.distributionCertificate.password,
    },
  };
}

export async function readEnvironmentSecretsAsync(
  projectDir: string
): Promise<Record<string, string> | undefined> {
  if (!(await fileExistsAsync(projectDir))) {
    return undefined;
  }
  const credentialsJson = await readAsync(projectDir);
  const npmToken = credentialsJson?.experimental?.npmToken;
  return npmToken ? { NPM_TOKEN: npmToken } : undefined;
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

export async function readRawAsync(projectDir: string): Promise<any> {
  const credentialsJsonFilePath = path.join(projectDir, 'credentials.json');
  try {
    const credentialsJSONContents = await fs.readFile(credentialsJsonFilePath, 'utf8');
    return JSON.parse(credentialsJSONContents);
  } catch (err) {
    throw new Error(
      `credentials.json must exist in the project root directory and contain a valid JSON`
    );
  }
}

function getAbsolutePath(projectDir: string, filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.join(projectDir, filePath);
}
