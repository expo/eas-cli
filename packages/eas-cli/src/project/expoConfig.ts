import { ExpoConfig, getConfig, getConfigFilePaths, modifyConfigAsync } from '@expo/config';
import { Env } from '@expo/eas-build-job';
import JsonFile from '@expo/json-file';
import fs from 'fs-extra';
import path from 'path';

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
  await ensureStaticExpoConfigIsValidAsync(projectDir);

  if (readOptions) {
    return modifyConfigAsync(projectDir, exp, readOptions);
  } else {
    return modifyConfigAsync(projectDir, exp);
  }
}

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
    const { exp } = getConfig(projectDir, {
      skipSDKVersionRequirement: true,
      ...(opts.isPublicConfig ? { isPublicConfig: true } : {}),
    });
    return exp;
  } finally {
    process.env = originalProcessEnv;
  }
}

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

async function ensureStaticExpoConfigIsValidAsync(projectDir: string): Promise<void> {
  const paths = getConfigFilePaths(projectDir);
  if (paths?.staticConfigPath?.endsWith('app.json') && !paths?.dynamicConfigPath) {
    const staticConfig = await JsonFile.readAsync(paths.staticConfigPath);

    // Add the "expo" key if it doesn't exist on app.json yet, such as in
    // projects initialized with RNC CLI
    if (!staticConfig?.expo) {
      staticConfig.expo = {};
      await JsonFile.writeAsync(paths.staticConfigPath, staticConfig);
    }
  }
}

export function getPublicExpoConfig(
  projectDir: string,
  opts: ExpoConfigOptions = {}
): PublicExpoConfig {
  ensureExpoConfigExists(projectDir);

  return getExpoConfigInternal(projectDir, { ...opts, isPublicConfig: true });
}
