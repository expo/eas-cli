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
      assertDependenciesInstalledForExpoConfig(projectDir);
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

/**
 * EAS CLI needs the project's dependencies to be installed to read the app config; it runs
 * `expo config` with the project's own copy of Expo CLI so the config is resolved consistently
 * across tools. If `expo` is declared in package.json but can't be resolved, the project's
 * dependencies aren't installed, so tell the developer what to do instead of failing later with
 * a confusing module resolution error. Projects that don't depend on the `expo` package are read
 * with the copy of `@expo/config` bundled with EAS CLI.
 */
function assertDependenciesInstalledForExpoConfig(projectDir: string): void {
  const packageJson = getPackageJson(projectDir);
  if (!packageJson?.dependencies?.expo || resolveFrom.silent(projectDir, 'expo/package.json')) {
    return;
  }

  const installCommand = `${resolvePackageManager(projectDir) ?? 'npm'} install`;
  throw new Error(
    `EAS CLI needs your project's dependencies to be installed to read your app config. Run ${chalk.bold(
      installCommand
    )} in your project directory and run this command again.`
  );
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
