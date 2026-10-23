import fs from 'fs';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import {
  EnvironmentSecretType,
  EnvironmentVariableScope,
  EnvironmentVariableVisibility,
} from '../../graphql/generated';
import { EnvironmentVariablesQuery } from '../../graphql/queries/EnvironmentVariablesQuery';
import {
  fetchServerEnvironmentVariablesAsync,
  removeSecretsDirectory,
} from '../serverEnvironmentVariables';

jest.mock('fs');
jest.mock('../../graphql/queries/EnvironmentVariablesQuery');

const graphqlClient = {} as ExpoGraphqlClient;

function variable(
  overrides: Partial<
    Awaited<ReturnType<typeof EnvironmentVariablesQuery.byAppIdWithSensitiveAsync>>[number]
  >
): Awaited<ReturnType<typeof EnvironmentVariablesQuery.byAppIdWithSensitiveAsync>>[number] {
  return {
    id: overrides.name ?? 'id',
    name: 'NAME',
    value: null,
    environments: ['development'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    scope: EnvironmentVariableScope.Project,
    visibility: EnvironmentVariableVisibility.Public,
    type: EnvironmentSecretType.String,
    ...overrides,
  };
}

describe(fetchServerEnvironmentVariablesAsync, () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  afterEach(() => {
    removeSecretsDirectory();
  });

  it('requests file contents', async () => {
    jest.mocked(EnvironmentVariablesQuery.byAppIdWithSensitiveAsync).mockResolvedValue([]);

    await fetchServerEnvironmentVariablesAsync(graphqlClient, {
      appId: 'app-id',
      environment: 'development',
    });

    expect(EnvironmentVariablesQuery.byAppIdWithSensitiveAsync).toHaveBeenCalledWith(
      graphqlClient,
      { appId: 'app-id', environment: 'development', includeFileContent: true }
    );
  });

  it('maps string variables to their values', async () => {
    jest
      .mocked(EnvironmentVariablesQuery.byAppIdWithSensitiveAsync)
      .mockResolvedValue([variable({ name: 'API_URL', value: 'https://example.test' })]);

    const env = await fetchServerEnvironmentVariablesAsync(graphqlClient, {
      appId: 'app-id',
      environment: 'development',
    });

    expect(env).toEqual({ API_URL: 'https://example.test' });
  });

  it('writes file variables to a temporary file and maps them to its path', async () => {
    const contents = '<plist>GOOGLE_APP_ID</plist>';
    jest.mocked(EnvironmentVariablesQuery.byAppIdWithSensitiveAsync).mockResolvedValue([
      variable({
        name: 'GOOGLE_SERVICES_PLIST',
        type: EnvironmentSecretType.FileBase64,
        valueWithFileContent: Buffer.from(contents).toString('base64'),
      }),
    ]);

    const env = await fetchServerEnvironmentVariablesAsync(graphqlClient, {
      appId: 'app-id',
      environment: 'development',
    });

    expect(env.GOOGLE_SERVICES_PLIST).toEqual(expect.stringContaining('eas-environment-secrets-'));
    expect(fs.readFileSync(env.GOOGLE_SERVICES_PLIST, 'utf8')).toBe(contents);
  });

  it('skips variables without a readable value', async () => {
    jest.mocked(EnvironmentVariablesQuery.byAppIdWithSensitiveAsync).mockResolvedValue([
      variable({ name: 'SECRET_TOKEN', visibility: EnvironmentVariableVisibility.Secret }),
      variable({
        name: 'SECRET_FILE',
        type: EnvironmentSecretType.FileBase64,
        visibility: EnvironmentVariableVisibility.Secret,
      }),
    ]);

    const env = await fetchServerEnvironmentVariablesAsync(graphqlClient, {
      appId: 'app-id',
      environment: 'development',
    });

    expect(env).toEqual({});
  });

  it.each(['SIGINT', 'SIGTERM', 'SIGHUP'] as const)(
    'removes the temporary files on %s',
    async signal => {
      jest.mocked(EnvironmentVariablesQuery.byAppIdWithSensitiveAsync).mockResolvedValue([
        variable({
          name: 'GOOGLE_SERVICES_PLIST',
          type: EnvironmentSecretType.FileBase64,
          valueWithFileContent: Buffer.from('<plist />').toString('base64'),
        }),
      ]);
      const env = await fetchServerEnvironmentVariablesAsync(graphqlClient, {
        appId: 'app-id',
        environment: 'development',
      });
      // Another listener handles the signal, so the process is not re-signalled.
      const otherListener = jest.fn();
      process.on(signal, otherListener);

      process.emit(signal, signal);
      process.removeListener(signal, otherListener);

      expect(fs.existsSync(env.GOOGLE_SERVICES_PLIST)).toBe(false);
      expect(otherListener).toHaveBeenCalled();
    }
  );
});
