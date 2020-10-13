import AppStoreApi from '../credentials/ios/appstore/AppStoreApi';
import { User } from '../user/User';
import { findProjectRootAsync } from '../utils/project';

export interface DeviceManagerContext {
  appStore: AppStoreApi;
  projectDir: string | null;
  user: User;
}

export async function createContext({
  appStore,
  cwd,
  user,
}: {
  appStore: AppStoreApi;
  cwd?: string;
  user: User;
}): Promise<DeviceManagerContext> {
  return {
    appStore,
    projectDir: await findProjectRootAsync(cwd),
    user,
  };
}
