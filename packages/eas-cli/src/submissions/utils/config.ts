import { ExpoConfig, getConfig } from '@expo/config';

interface AppConfig {
  owner?: string;
  slug: string;
}

export function getAppConfig(projecDir: string): AppConfig {
  const exp = getExpoConfig(projecDir);
  if (!exp.slug) {
    throw new Error('expo.slug is not defined in app.json');
  }
  return {
    owner: exp.owner,
    slug: exp.slug,
  };
}

let exp: ExpoConfig;
export function getExpoConfig(projectDir: string): ExpoConfig {
  if (!exp) {
    const { exp: _exp } = getConfig(projectDir, { skipSDKVersionRequirement: true });
    exp = _exp;
  }
  return exp;
}
