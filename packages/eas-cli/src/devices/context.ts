import AppStoreApi from '../credentials/ios/appstore/AppStoreApi';
import { findProjectRootAsync } from '../project/projectUtils';
import { Actor } from '../user/User';

export interface DeviceManagerContext {
  appStore: AppStoreApi;
  projectDir: string | null;
  user: Actor;
}

export async function createContext({
  appStore,
  cwd,
  user,
}: {
  appStore: AppStoreApi;
  cwd?: string;
  user: Actor;
}): Promise<DeviceManagerContext> {
  return {
    appStore,
    projectDir: await findProjectRootAsync(cwd),
    user,
  };
}
