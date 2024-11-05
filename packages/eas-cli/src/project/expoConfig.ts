import { ExpoConfig, getConfig, getConfigFilePaths, modifyConfigAsync } from '@expo/config';
import { Env } from '@expo/eas-build-job';
import spawnAsync from '@expo/spawn-async';
import fs from 'fs-extra';
import Joi from 'joi';
import path from 'path';

import { isExpoInstalled } from './projectUtils';
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

async function getExpoConfigInternalAsync(
  projectDir: string,
  opts: ExpoConfigOptionsInternal = {}
): Promise<ExpoConfig> {
  const originalProcessEnv: NodeJS.ProcessEnv = process.env;
  try {
    process.env = {
      ...process.env,
      ...opts.env,
    };

    let exp: ExpoConfig;
    if (isExpoInstalled(projectDir)) {
      try {
        const { stdout } = await spawnAsync(
          'npx',
          ['expo', 'config', '--json', ...(opts.isPublicConfig ? ['--type', 'public'] : [])],

          {
            cwd: projectDir,
            env: {
              ...process.env,
              ...opts.env,
              EXPO_NO_DOTENV: '1',
            },
          }
        );
        exp = JSON.parse(stdout);
      } catch (err: any) {
        if (!wasExpoConfigWarnPrinted) {
          Log.warn(
            `Failed to read the app config from the project using "npx expo config" command: ${err.message}.`
          );
          Log.warn('Falling back to the version of "@expo/config" shipped with the EAS CLI.');
          wasExpoConfigWarnPrinted = true;
        }
        exp = getConfig(projectDir, {
          skipSDKVersionRequirement: true,
          ...(opts.isPublicConfig ? { isPublicConfig: true } : {}),
          ...(opts.skipPlugins ? { skipPlugins: true } : {}),
        }).exp;
      }
    } else {
      exp = getConfig(projectDir, {
        skipSDKVersionRequirement: true,
        ...(opts.isPublicConfig ? { isPublicConfig: true } : {}),
        ...(opts.skipPlugins ? { skipPlugins: true } : {}),
      }).exp;
    }

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

export async function getPrivateExpoConfigAsync(
  projectDir: string,
  opts: ExpoConfigOptions = {}
): Promise<ExpoConfig> {
  ensureExpoConfigExists(projectDir);

  return await getExpoConfigInternalAsync(projectDir, { ...opts, isPublicConfig: false });
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

export async function getPublicExpoConfigAsync(
  projectDir: string,
  opts: ExpoConfigOptions = {}
): Promise<PublicExpoConfig> {
  ensureExpoConfigExists(projectDir);

  return await getExpoConfigInternalAsync(projectDir, { ...opts, isPublicConfig: true });
}
