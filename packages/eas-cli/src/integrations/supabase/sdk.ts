import { ExpoConfig } from '@expo/config';

import {
  SdkInstallResult,
  addConfigPluginAsync as addConfigPluginWithConfigAsync,
  installSdkPackagesAsync as installSdkPackagesWithConfigAsync,
  setupSdkAndConfigAsync as setupSdkAndConfigWithConfigAsync,
} from '../shared/sdk';

export type { SdkInstallResult };
export {
  getSpawnErrorOutput,
  extractDynamicConfigGuidance,
  envForExpoInstall,
} from '../shared/sdk';

export const SDK_PACKAGES = ['@supabase/supabase-js', 'react-native-url-polyfill', 'expo-sqlite'];
export const CONFIG_PLUGIN = 'expo-sqlite';

const SUPABASE_SDK_LABEL = 'Supabase';

export async function installSdkPackagesAsync(
  projectDir: string,
  jsonFlag: boolean
): Promise<SdkInstallResult> {
  return await installSdkPackagesWithConfigAsync(projectDir, {
    packages: SDK_PACKAGES,
    label: SUPABASE_SDK_LABEL,
    jsonFlag,
  });
}

export async function addConfigPluginAsync(
  projectDir: string,
  exp: ExpoConfig
): Promise<string | null> {
  return await addConfigPluginWithConfigAsync(projectDir, exp, { plugin: CONFIG_PLUGIN });
}

export async function setupSdkAndConfigAsync(
  projectDir: string,
  exp: ExpoConfig,
  jsonFlag: boolean
): Promise<string[]> {
  return await setupSdkAndConfigWithConfigAsync(projectDir, exp, {
    packages: SDK_PACKAGES,
    plugin: CONFIG_PLUGIN,
    label: SUPABASE_SDK_LABEL,
    jsonFlag,
  });
}
