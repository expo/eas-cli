import { getConfig, modifyConfigAsync } from '@expo/config';
import { vol } from 'memfs';

import { Actor, getUserAsync } from '../../user/User';
import { fetchOrCreateProjectIDForWriteToConfigWithConfirmationAsync } from '../fetchOrCreateProjectIDForWriteToConfigWithConfirmationAsync';
import { findProjectRootAsync, getProjectAccountName, getProjectIdAsync } from '../projectUtils';

jest.mock('@expo/config');
jest.mock('fs');

jest.mock('../fetchOrCreateProjectIDForWriteToConfigWithConfirmationAsync');
jest.mock('../../prompts');
jest.mock('../../user/User');
jest.mock('../../ora', () => ({
  ora: () => ({
    start: () => ({ succeed: () => {}, fail: () => {} }),
  }),
}));

beforeEach(() => {
  jest.resetAllMocks();
});

describe(findProjectRootAsync, () => {
  beforeEach(() => {
    vol.reset();
  });

  it('throws if not inside the project directory', async () => {
    vol.fromJSON(
      {
        './README.md': '1',
      },
      '/app'
    );
    await expect(findProjectRootAsync({ cwd: '/app' })).rejects.toThrow(
      'Run this command inside a project directory.'
    );
  });

  it('defaults to process.cwd() if defaultToProcessCwd = true', async () => {
    const spy = jest.spyOn(process, 'cwd').mockReturnValue('/this/is/fake/process/cwd');
    try {
      vol.fromJSON(
        {
          './README.md': '1',
        },
        '/app'
      );
      const projectDir = await findProjectRootAsync({ cwd: '/app', defaultToProcessCwd: true });
      expect(projectDir).toBe('/this/is/fake/process/cwd');
    } finally {
      spy.mockRestore();
    }
  });

  it('returns the root directory of the project', async () => {
    vol.fromJSON(
      {
        './README.md': '1',
        './package.json': '2',
        './src/index.ts': '3',
      },
      '/app'
    );
    const projectRoot = await findProjectRootAsync({ cwd: '/app/src' });
    expect(projectRoot).toBe('/app');
  });
});

describe(getProjectAccountName, () => {
  const expWithOwner: any = { owner: 'dominik' };
  const expWithoutOwner: any = {};

  it('returns owner for user actor', () => {
    const projectAccountName = getProjectAccountName(expWithOwner, {
      __typename: 'User',
      id: 'userId',
      username: 'notbrent',
      accounts: [],
      isExpoAdmin: false,
    });
    expect(projectAccountName).toBe(expWithOwner.owner);
  });

  it('returns owner for robot actor', () => {
    const projectAccountName = getProjectAccountName(expWithOwner, {
      __typename: 'Robot',
      id: 'userId',
      firstName: 'notauser',
      accounts: [],
      isExpoAdmin: false,
    });
    expect(projectAccountName).toBe(expWithOwner.owner);
  });

  it('returns username for user actor when owner is undefined', () => {
    const projectAccountName = getProjectAccountName(expWithoutOwner, {
      __typename: 'User',
      id: 'userId',
      username: 'dominik',
      accounts: [],
      isExpoAdmin: false,
    });
    expect(projectAccountName).toBe('dominik');
  });

  it('throws for robot actor when owner is undefined', () => {
    const resolveProjectAccountName = (): string =>
      getProjectAccountName(expWithoutOwner, {
        __typename: 'Robot',
        id: 'userId',
        firstName: 'notauser',
        accounts: [],
        isExpoAdmin: false,
      });
    expect(resolveProjectAccountName).toThrow('manifest property is required');
  });
});

describe(getProjectIdAsync, () => {
  beforeEach(() => {
    jest.mocked(getUserAsync).mockImplementation(
      async (): Promise<Actor> => ({
        __typename: 'User',
        id: 'user_id',
        username: 'notnotbrent',
        accounts: [
          { id: 'account_id_1', name: 'notnotbrent' },
          { id: 'account_id_2', name: 'dominik' },
        ],
        isExpoAdmin: false,
      })
    );
  });

  it('gets the project ID from app config if exists', async () => {
    await expect(
      getProjectIdAsync(
        { name: 'test', slug: 'test', extra: { eas: { projectId: '1234' } } },
        { nonInteractive: false }
      )
    ).resolves.toEqual('1234');
  });

  it('fetches the project ID when not in app config, and sets it in the config', async () => {
    jest.mocked(getConfig).mockReturnValue({ exp: { name: 'test', slug: 'test' } } as any);
    jest.mocked(modifyConfigAsync).mockResolvedValue({
      type: 'success',
      config: { expo: { name: 'test', slug: 'test', extra: { eas: { projectId: '2345' } } } },
    });
    jest
      .mocked(fetchOrCreateProjectIDForWriteToConfigWithConfirmationAsync)
      .mockImplementation(async () => '2345');

    const projectId = await getProjectIdAsync(
      { name: 'test', slug: 'test' },
      { nonInteractive: false },
      { cwd: '/app' }
    );
    expect(projectId).toBe('2345');

    expect(modifyConfigAsync).toHaveBeenCalledTimes(1);
    expect(modifyConfigAsync).toHaveBeenCalledWith('/app', {
      extra: { eas: { projectId: '2345' } },
    });
  });

  it('throws if writing the ID back to the config fails', async () => {
    jest.mocked(getConfig).mockReturnValue({ exp: { name: 'test', slug: 'test' } } as any);
    jest.mocked(modifyConfigAsync).mockResolvedValue({
      type: 'fail',
      config: null,
    });
    jest
      .mocked(fetchOrCreateProjectIDForWriteToConfigWithConfirmationAsync)
      .mockImplementation(async () => '4567');

    await expect(
      getProjectIdAsync({ name: 'test', slug: 'test' }, { nonInteractive: false }, { cwd: '/app' })
    ).rejects.toThrow();
  });
});
