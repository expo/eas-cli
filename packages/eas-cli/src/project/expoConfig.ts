import {
  ExpoConfig,
  getConfig,
  getConfigFilePaths,
  getPackageJson,
  modifyConfigAsync,
} from '@expo/config';
import { Env } from '@expo/eas-build-job';
import { resolvePackageManager } from '@expo/package-manager';
import chalk from 'chalk';
import fs from 'fs-extra';
import Joi from 'joi';
import path from 'path';
import resolveFrom from 'resolve-from';

import { isExpoInstalled } from './projectUtils';
import { spawnExpoCommand } from '../utils/expoCli';

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
      const { stdout } = await spawnExpoCommand(
        projectDir,
        ['config', '--json', ...(opts.isPublicConfig ? ['--type', 'public'] : [])],
        {
          env: {
            EXPO_NO_DOTENV: '1',
          },
        }
      );
      exp = JSON.parse(stdout);
    } else {
      exp = getConfigWithBundledExpoConfig(projectDir, opts);
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

/**
 * Read the app config with the copy of `@expo/config` bundled with EAS CLI. This is used when the
 * project's own copy of Expo CLI can't be resolved, most commonly because the project's
 * dependencies aren't installed. Reading the config often fails in that case too (config plugins
 * and dynamic configs import from the project's dependencies), so detect it and print an
 * actionable error message instead of a confusing module resolution error.
 */
function getConfigWithBundledExpoConfig(
  projectDir: string,
  opts: ExpoConfigOptionsInternal
): ExpoConfig {
  try {
    return getConfig(projectDir, {
      skipSDKVersionRequirement: true,
      ...(opts.isPublicConfig ? { isPublicConfig: true } : {}),
      ...(opts.skipPlugins ? { skipPlugins: true } : {}),
    }).exp;
  } catch (error: any) {
    if (!isExpoDeclaredButUninstalled(projectDir)) {
      throw error;
    }

    const installCommand = `${resolvePackageManager(projectDir) ?? 'npm'} install`;
    throw new Error(
      `Your project's dependencies aren't installed and EAS CLI needs them to read your app config. Run ${chalk.bold(
        installCommand
      )} in your project directory and run this command again.\n${chalk.dim(error.message)}`
    );
  }
}

/**
 * Whether `expo` is declared in the project's package.json dependencies but can't be resolved,
 * which means the project's dependencies aren't installed.
 */
function isExpoDeclaredButUninstalled(projectDir: string): boolean {
  const packageJson = getPackageJson(projectDir);
  return !!packageJson.dependencies?.expo && !resolveFrom.silent(projectDir, 'expo/package.json');
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
