import { ExpoConfig, getConfig } from '@expo/config';

import AppStoreApi from '../credentials/ios/appstore/AppStoreApi';
import { findProjectRootAsync } from '../project/projectUtils';
import { Actor } from '../user/User';

export interface DeviceManagerContext {
  appStore: AppStoreApi;
  exp: ExpoConfig | null;
  projectDir: string | null;
  user: Actor;
}

export async function createContextAsync({
  appStore,
  cwd,
  user,
}: {
  appStore: AppStoreApi;
  cwd?: string;
  user: Actor;
}): Promise<DeviceManagerContext> {
  const projectDir = await findProjectRootAsync({ cwd });
  let exp: ExpoConfig | null = null;
  if (projectDir) {
    const config = getConfig(projectDir, { skipSDKVersionRequirement: true });
    exp = config.exp;
  }
  return {
    appStore,
    projectDir,
    exp,
    user,
  };
}
