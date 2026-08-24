import { ExpoConfig, getConfig, getConfigFilePaths, modifyConfigAsync } from '@expo/config';
import { Env } from '@expo/eas-build-job';
import fs from 'fs-extra';
import Joi from 'joi';
import path from 'path';

import { isExpoInstalled } from './projectUtils';
import { spawnExpoCommand } from '../utils/expoCli';
import { getEnvWithoutInheritedDotenvValues } from '../utils/originalEnv';

export type ExpoConfigMode = 'development' | 'production';

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
  mode?: ExpoConfigMode;
  skipSDKVersionRequirement?: boolean;
  skipPlugins?: boolean;
}

interface ExpoConfigOptionsInternal extends ExpoConfigOptions {
  isPublicConfig?: boolean;
}

export async function createOrModifyExpoConfigAsync(
  projectDir: string,
  exp: Partial<ExpoConfig>,
  readOptions?: Pick<ExpoConfigOptions, 'env' | 'mode' | 'skipSDKVersionRequirement'>
): ReturnType<typeof modifyConfigAsync> {
  ensureExpoConfigExists(projectDir);

  const originalProcessEnv = process.env;
  const { env, mode, ...configReadOptions } = readOptions ?? {};
  try {
    process.env = getInProcessExpoConfigEnv({ env, mode });
    if (readOptions) {
      return await modifyConfigAsync(projectDir, exp, configReadOptions);
    } else {
      return await modifyConfigAsync(projectDir, exp);
    }
  } finally {
    process.env = originalProcessEnv;
  }
}

async function getExpoConfigInternalAsync(
  projectDir: string,
  opts: ExpoConfigOptionsInternal = {}
): Promise<ExpoConfig> {
  const originalProcessEnv: NodeJS.ProcessEnv = process.env;
  try {
    process.env = getInProcessExpoConfigEnv(opts);

    let exp: ExpoConfig;
    if (isExpoInstalled(projectDir)) {
      const { stdout } = await spawnExpoCommand(
        projectDir,
        ['config', '--json', ...(opts.isPublicConfig ? ['--type', 'public'] : [])],
        {
          env: {
            EXPO_NO_DOTENV: '1',
            ...(opts.mode
              ? {
                  NODE_ENV: opts.mode,
                  __EXPO_CONFIG_MODE: opts.mode,
                }
              : {}),
          },
        }
      );
      exp = JSON.parse(stdout);
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

function getInProcessExpoConfigEnv(
  opts: Pick<ExpoConfigOptions, 'env' | 'mode'>
): NodeJS.ProcessEnv {
  const configEnv = {
    ...getEnvWithoutInheritedDotenvValues(process.env),
    ...opts.env,
  };
  if (opts.mode) {
    configEnv.NODE_ENV = opts.mode;
  }
  delete configEnv.__EXPO_CONFIG_MODE;
  delete configEnv.__EXPO_ENV_LOADED;
  return configEnv;
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
