import { ExpoConfig, getConfig } from '@expo/config';
import { Env } from '@expo/eas-build-job';

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
  return getExpoConfigInternal(projectDir, { ...opts, isPublicConfig: false });
}

export function getPublicExpoConfig(
  projectDir: string,
  opts: ExpoConfigOptions = {}
): PublicExpoConfig {
  return getExpoConfigInternal(projectDir, { ...opts, isPublicConfig: true });
}
