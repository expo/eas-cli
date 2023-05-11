import { ExpoConfig } from '@expo/config';
import { BuildProfile, Platform } from '@expo/eas-json';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';

async function defaultGetApplicationIdentifierAsync(_opts: {
  graphqlClient: ExpoGraphqlClient;
  projectDir: string;
  projectId: string;
  exp: ExpoConfig;
  buildProfile: BuildProfile;
  platform: Platform;
}): Promise<string> {
  return 'eas.test.com';
}

export const getApplicationIdentifierAsync = jest.fn(defaultGetApplicationIdentifierAsync);
