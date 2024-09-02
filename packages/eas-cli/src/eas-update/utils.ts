import { ExpoConfig } from '@expo/config';

import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { Client } from '../vcs/vcs';

export type EASUpdateContext = {
  graphqlClient: ExpoGraphqlClient;
  nonInteractive: boolean;
  app: { exp: ExpoConfig; projectId: string; projectDir: string };
  vcsClient: Client;
};

export interface EASUpdateAction<T = any> {
  runAsync(ctx: EASUpdateContext): Promise<T>;
}

export class NonInteractiveError extends Error {}
