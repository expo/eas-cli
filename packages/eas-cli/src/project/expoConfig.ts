import { ExpoConfig, getConfig, getConfigFilePaths, modifyConfigAsync } from '@expo/config';
import { Env } from '@expo/eas-build-job';
import fs from 'fs-extra';
import Joi from 'joi';
import path from 'path';

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
      let stdout: string;
      try {
        ({ stdout } = await spawnExpoCommand(
          projectDir,
          ['config', '--json', ...(opts.isPublicConfig ? ['--type', 'public'] : [])],
          {
            env: {
              EXPO_NO_DOTENV: '1',
            },
          }
        ));
      } catch (error: any) {
        throw new Error(expoConfigCommandFailedMessage(projectDir, error));
      }
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

/**
 * The Expo CLI prints the reason it failed on stderr, but a rejected spawn only carries
 * "exited with non-zero code", so surface the output and name the usual cause: dependencies that
 * are missing or half-installed.
 */
function expoConfigCommandFailedMessage(projectDir: string, error: any): string {
  const stderr = typeof error?.stderr === 'string' ? error.stderr.trim() : '';
  const parts = ['Failed to read the app config from the Expo CLI.'];
  if (stderr) {
    parts.push(stderr);
  }
  const dependenciesUnresolved =
    /Cannot find module|MODULE_NOT_FOUND/.test(stderr) ||
    !fs.existsSync(path.join(projectDir, 'node_modules'));
  if (dependenciesUnresolved) {
    parts.push(
      'The project dependencies look missing or incomplete. Install them and run this command again.'
    );
  }
  return parts.join('\n\n');
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
