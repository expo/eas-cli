import * as fs from 'fs-extra';

import { EnvironmentVariableVisibility } from '../../../graphql/generated';
import { createSurrealEnvVars, hasEnvLocalKeysAsync, removeEnvLocalKeysAsync } from '../env';

jest.mock('fs-extra');

const projectDir = '/project';

describe(createSurrealEnvVars, () => {
  it('creates public endpoint, namespace and database variables', () => {
    expect(
      createSurrealEnvVars({
        endpoint: 'wss://db.example.com',
        namespace: 'app',
        database: 'main',
      })
    ).toEqual([
      {
        name: 'EXPO_PUBLIC_SURREAL_ENDPOINT',
        value: 'wss://db.example.com',
        visibility: EnvironmentVariableVisibility.Public,
      },
      {
        name: 'EXPO_PUBLIC_SURREAL_NAMESPACE',
        value: 'app',
        visibility: EnvironmentVariableVisibility.Public,
      },
      {
        name: 'EXPO_PUBLIC_SURREAL_DATABASE',
        value: 'main',
        visibility: EnvironmentVariableVisibility.Public,
      },
    ]);
  });
});

describe('.env.local helpers', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.mocked(fs.pathExists).mockResolvedValue(true as never);
  });

  function mockEnvLocal(content: string): void {
    jest.mocked(fs.readFile).mockResolvedValue(content as never);
  }

  it('removes only the SurrealDB keys, including export-prefixed and spaced ones', async () => {
    mockEnvLocal(
      [
        'OTHER=1',
        'EXPO_PUBLIC_SURREAL_ENDPOINT=wss://db.example.com',
        'export EXPO_PUBLIC_SURREAL_NAMESPACE=app',
        'EXPO_PUBLIC_SURREAL_DATABASE = main',
        'EXPO_PUBLIC_SURREAL_ENDPOINT_OLD=keep',
        '',
      ].join('\n')
    );

    await expect(removeEnvLocalKeysAsync(projectDir)).resolves.toBe(true);

    expect(fs.writeFile).toHaveBeenCalledWith(
      '/project/.env.local',
      'OTHER=1\nEXPO_PUBLIC_SURREAL_ENDPOINT_OLD=keep\n'
    );
  });

  it('leaves the file alone when it has no SurrealDB keys', async () => {
    mockEnvLocal('OTHER=1\n');

    await expect(removeEnvLocalKeysAsync(projectDir)).resolves.toBe(false);
    await expect(hasEnvLocalKeysAsync(projectDir)).resolves.toBe(false);
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it('reports SurrealDB keys in .env.local', async () => {
    mockEnvLocal('EXPO_PUBLIC_SURREAL_ENDPOINT=wss://db.example.com\n');

    await expect(hasEnvLocalKeysAsync(projectDir)).resolves.toBe(true);
  });

  it('handles a missing .env.local', async () => {
    jest.mocked(fs.pathExists).mockResolvedValue(false as never);

    await expect(removeEnvLocalKeysAsync(projectDir)).resolves.toBe(false);
    await expect(hasEnvLocalKeysAsync(projectDir)).resolves.toBe(false);
  });
});
