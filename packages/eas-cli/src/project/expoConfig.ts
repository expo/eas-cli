import {
  ExpoConfig,
  getConfig as _getConfig,
  getConfigFilePaths,
  modifyConfigAsync,
} from '@expo/config';
import { Env } from '@expo/eas-build-job';
import fs from 'fs-extra';
import Joi from 'joi';
import path from 'path';

import Log from '../log';

export type PublicExpoConfig = Omit<
  ExpoConfig,
  '_internal' | 'hooks' | 'ios' | 'android' | 'updates'
> & {
  ios?: Omit<ExpoConfig['ios'], 'config'>;
  android?: Omit<ExpoConfig['android'], 'config'>;
  updates?: Omit<ExpoConfig['updates'], 'codeSigningCertificate' | 'codeSigningMetadata'>;
};

export interface ExpoConfigOptions {
  env?: Env;
  skipSDKVersionRequirement?: boolean;
  skipPlugins?: boolean;
}

interface ExpoConfigOptionsInternal extends ExpoConfigOptions {
  isPublicConfig?: boolean;
}

export async function createOrModifyExpoConfigAsync(
  projectDir: string,
  exp: Partial<ExpoConfig>,
  readOptions?: { skipSDKVersionRequirement?: boolean }
): ReturnType<typeof modifyConfigAsync> {
  ensureExpoConfigExists(projectDir);

  if (readOptions) {
    return await modifyConfigAsync(projectDir, exp, readOptions);
  } else {
    return await modifyConfigAsync(projectDir, exp);
  }
}

let wasExpoConfigWarnPrinted = false;

function getExpoConfigInternal(
  projectDir: string,
  opts: ExpoConfigOptionsInternal = {}
): ExpoConfig {
  const originalProcessEnv: NodeJS.ProcessEnv = process.env;
  try {
    process.env = {
      ...process.env,
      ...opts.env,
    };
    const projectExpoConfigPath = path.join(projectDir, 'node_modules', '@expo', 'config');
    let getConfig: typeof _getConfig;
    try {
      const expoConfig = require(projectExpoConfigPath);
      getConfig = expoConfig.getConfig;
    } catch {
      if (!wasExpoConfigWarnPrinted) {
        Log.warn(`Failed to load getConfig function from ${projectExpoConfigPath}`);
        Log.warn('Falling back to the version of @expo/config shipped with the EAS CLI.');
        wasExpoConfigWarnPrinted = true;
      }
      getConfig = _getConfig;
    }
    const { exp } = getConfig(projectDir, {
      skipSDKVersionRequirement: true,
      ...(opts.isPublicConfig ? { isPublicConfig: true } : {}),
      ...(opts.skipPlugins ? { skipPlugins: true } : {}),
    });

    const { error } = MinimalAppConfigSchema.validate(exp, {
      allowUnknown: true,
      abortEarly: true,
    });
    if (error) {
      throw new Error(`Invalid app config.\n${error.message}`);
    }
    return exp;
  } finally {
    process.env = originalProcessEnv;
  }
}

const MinimalAppConfigSchema = Joi.object({
  slug: Joi.string().required(),
  name: Joi.string().required(),
  version: Joi.string(),
  android: Joi.object({
    versionCode: Joi.number().integer(),
  }),
  ios: Joi.object({
    buildNumber: Joi.string(),
  }),
});

export function getPrivateExpoConfig(projectDir: string, opts: ExpoConfigOptions = {}): ExpoConfig {
  ensureExpoConfigExists(projectDir);

  return getExpoConfigInternal(projectDir, { ...opts, isPublicConfig: false });
}

export function ensureExpoConfigExists(projectDir: string): void {
  const paths = getConfigFilePaths(projectDir);
  if (!paths?.staticConfigPath && !paths?.dynamicConfigPath) {
    // eslint-disable-next-line node/no-sync
    fs.writeFileSync(path.join(projectDir, 'app.json'), JSON.stringify({ expo: {} }, null, 2));
  }
}

export function isUsingStaticExpoConfig(projectDir: string): boolean {
  const paths = getConfigFilePaths(projectDir);
  return !!(paths.staticConfigPath?.endsWith('app.json') && !paths.dynamicConfigPath);
}

export function getPublicExpoConfig(
  projectDir: string,
  opts: ExpoConfigOptions = {}
): PublicExpoConfig {
  ensureExpoConfigExists(projectDir);

  return getExpoConfigInternal(projectDir, { ...opts, isPublicConfig: true });
}
