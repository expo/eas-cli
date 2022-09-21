import AppStoreApi from '../credentials/ios/appstore/AppStoreApi';
import { Actor } from '../user/User';

export interface DeviceManagerContext {
  appStore: AppStoreApi;
  user: Actor;
  projectId: string | null;
}

export async function createContextAsync({
  appStore,
  user,
  projectId,
}: {
  appStore: AppStoreApi;
  user: Actor;
  projectId: string | undefined;
}): Promise<DeviceManagerContext> {
  return {
    appStore,
    user,
    projectId: projectId ?? null,
  };
}
