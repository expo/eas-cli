import { ExpoConfig } from '@expo/config-types';

import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';

export type EASUpdateContext = {
  graphqlClient: ExpoGraphqlClient;
  nonInteractive: boolean;
  app: { exp: ExpoConfig; projectId: string; projectDir: string };
};

export interface EASUpdateAction<T = any> {
  runAsync(ctx: EASUpdateContext): Promise<T>;
}

export class NonInteractiveError extends Error {}
