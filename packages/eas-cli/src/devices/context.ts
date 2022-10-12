import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import AppStoreApi from '../credentials/ios/appstore/AppStoreApi';
import { Actor } from '../user/User';

export interface DeviceManagerContext {
  appStore: AppStoreApi;
  user: Actor;
  graphqlClient: ExpoGraphqlClient;
  projectId: string | null;
}

export async function createContextAsync({
  appStore,
  user,
  graphqlClient,
  projectId,
}: {
  appStore: AppStoreApi;
  user: Actor;
  graphqlClient: ExpoGraphqlClient;
  projectId: string | undefined;
}): Promise<DeviceManagerContext> {
  return {
    appStore,
    user,
    graphqlClient,
    projectId: projectId ?? null,
  };
}
