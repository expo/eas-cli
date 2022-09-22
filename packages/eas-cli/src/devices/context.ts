import AppStoreApi from '../credentials/ios/appstore/AppStoreApi';
import { Actor } from '../user/User';

export interface DeviceManagerContext {
  appStore: AppStoreApi;
  user: Actor;
  projectId: string;
}

export async function createContextAsync({
  appStore,
  user,
  projectId,
}: {
  appStore: AppStoreApi;
  user: Actor;
  projectId: string;
}): Promise<DeviceManagerContext> {
  return {
    appStore,
    user,
    projectId,
  };
}
