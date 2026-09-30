import { getConfigFilePaths } from '@expo/config';

import { getPrivateExpoConfigAsync } from './expoConfig';

export async function detectProjectSdkVersionAsync(
  projectDir: string
): Promise<string | undefined> {
  const paths = getConfigFilePaths(projectDir);
  if (!paths.staticConfigPath && !paths.dynamicConfigPath) {
    return;
  }
  try {
    return (await getPrivateExpoConfigAsync(projectDir)).sdkVersion;
  } catch {
    return;
  }
}
