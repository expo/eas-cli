import AppStoreApi from '../credentials/ios/appstore/AppStoreApi';
import { findProjectRootAsync } from '../project/projectUtils';
import { RobotUser, User } from '../user/User';

export interface DeviceManagerContext {
  appStore: AppStoreApi;
  projectDir: string | null;
  user: User | RobotUser;
}

export async function createContext({
  appStore,
  cwd,
  user,
}: {
  appStore: AppStoreApi;
  cwd?: string;
  user: User | RobotUser;
}): Promise<DeviceManagerContext> {
  return {
    appStore,
    projectDir: await findProjectRootAsync(cwd),
    user,
  };
}
