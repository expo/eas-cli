import { Platform } from '@expo/eas-build-job';
import { BuildProfile } from '@expo/eas-json';

import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import {
  EnvironmentSecretType,
  EnvironmentVariableScope,
  EnvironmentVariableVisibility,
} from '../../../graphql/generated';
import { EnvironmentVariablesQuery } from '../../../graphql/queries/EnvironmentVariablesQuery';
import { Action } from '../HelperActions';
import { resolveBuildProfileEnvAsync } from '../resolveBuildProfileEnvAsync';

jest.mock('../../../graphql/queries/EnvironmentVariablesQuery');
jest.mock('../../../log');

describe(resolveBuildProfileEnvAsync, () => {
  const graphqlClient = {} as ExpoGraphqlClient;
  const callingAction = {
    graphqlClient,
    getDynamicPrivateProjectConfigAsync: jest.fn().mockResolvedValue({ projectId: 'app-id' }),
  } as unknown as Action;

  beforeEach(() => {
    jest.mocked(EnvironmentVariablesQuery.byAppIdWithSensitiveAsync).mockResolvedValue([
      {
        id: 'var1',
        name: 'API_URL',
        value: 'https://from-eas.example.test',
        environments: ['development'],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        scope: EnvironmentVariableScope.Project,
        visibility: EnvironmentVariableVisibility.Public,
        type: EnvironmentSecretType.String,
      },
    ]);
  });

  it("loads the profile's EAS environment and overlays the profile env", async () => {
    const buildProfile = {
      environment: 'development',
      env: { APP_VARIANT: 'development' },
    } as unknown as BuildProfile<Platform.IOS>;

    const env = await resolveBuildProfileEnvAsync(callingAction, {
      buildProfile,
      buildProfileName: 'development',
    });

    expect(EnvironmentVariablesQuery.byAppIdWithSensitiveAsync).toHaveBeenCalledWith(
      graphqlClient,
      { appId: 'app-id', environment: 'development', includeFileContent: true }
    );
    expect(env).toEqual({
      API_URL: 'https://from-eas.example.test',
      APP_VARIANT: 'development',
    });
  });
});
