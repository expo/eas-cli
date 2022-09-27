import { getConfig, modifyConfigAsync } from '@expo/config';
import { vol } from 'memfs';

import { Role } from '../../../graphql/generated';
import { fetchOrCreateProjectIDForWriteToConfigWithConfirmationAsync } from '../../../project/fetchOrCreateProjectIDForWriteToConfigWithConfirmationAsync';
import ActorContextField from '../ActorContextField';
import ProjectConfigContextField from '../ProjectConfigContextField';
import ProjectDirContextField from '../ProjectDirContextField';

jest.mock('@expo/config');
jest.mock('fs');

jest.mock('../ActorContextField');
jest.mock('../ProjectDirContextField');
jest.mock('../../../user/User');
jest.mock('../../../ora', () => ({
  ora: () => ({
    start: () => ({ succeed: () => {}, fail: () => {} }),
  }),
}));
jest.mock('../../../project/fetchOrCreateProjectIDForWriteToConfigWithConfirmationAsync');

describe(ProjectConfigContextField.name, () => {
  beforeEach(() => {
    jest.mocked(ActorContextField['ensureLoggedInAsync']).mockResolvedValue({
      __typename: 'User',
      id: 'user_id',
      username: 'notnotbrent',
      primaryAccount: {
        id: 'account_id_1',
        name: 'notnotbrent',
        users: [{ role: Role.Owner, actor: { id: 'user_id' } }],
      },
      accounts: [
        {
          id: 'account_id_1',
          name: 'notnotbrent',
          users: [{ role: Role.Owner, actor: { id: 'user_id' } }],
        },
        {
          id: 'account_id_2',
          name: 'dominik',
          users: [{ role: Role.ViewOnly, actor: { id: 'user_id' } }],
        },
      ],
      isExpoAdmin: false,
    });

    vol.fromJSON(
      {
        './README.md': '1',
        './package.json': '2',
        './src/index.ts': '3',
      },
      '/app'
    );
  });

  it('gets the project ID from app config if exists', async () => {
    jest.mocked(getConfig).mockReturnValue({
      exp: { name: 'test', slug: 'test', extra: { eas: { projectId: '1234' } } },
    } as any);
    jest.mocked(ProjectDirContextField['findProjectRootAsync']).mockResolvedValue('/app');
    await expect(
      new ProjectConfigContextField().getValueAsync({ nonInteractive: false })
    ).resolves.toEqual({
      projectId: '1234',
      exp: { name: 'test', slug: 'test', extra: { eas: { projectId: '1234' } } },
    });
  });

  it('fetches the project ID when not in app config, and sets it in the config', async () => {
    jest.mocked(getConfig).mockReturnValue({ exp: { name: 'test', slug: 'test' } } as any);
    jest.mocked(ProjectDirContextField['findProjectRootAsync']).mockResolvedValue('/app');
    jest.mocked(modifyConfigAsync).mockResolvedValue({
      type: 'success',
      config: { expo: { name: 'test', slug: 'test', extra: { eas: { projectId: '2345' } } } },
    });
    jest
      .mocked(fetchOrCreateProjectIDForWriteToConfigWithConfirmationAsync)
      .mockImplementation(async () => '2345');

    const projectConfig = await new ProjectConfigContextField().getValueAsync({
      nonInteractive: false,
    });
    expect(projectConfig).toMatchObject({
      projectId: '2345',
      exp: expect.any(Object),
    });

    expect(modifyConfigAsync).toHaveBeenCalledTimes(1);
    expect(modifyConfigAsync).toHaveBeenCalledWith('/app', {
      extra: { eas: { projectId: '2345' } },
    });
  });

  it('throws if writing the ID back to the config fails', async () => {
    jest.mocked(getConfig).mockReturnValue({ exp: { name: 'test', slug: 'test' } } as any);
    jest.mocked(ProjectDirContextField['findProjectRootAsync']).mockResolvedValue('/app');
    jest.mocked(modifyConfigAsync).mockResolvedValue({
      type: 'fail',
      config: null,
    });
    jest
      .mocked(fetchOrCreateProjectIDForWriteToConfigWithConfirmationAsync)
      .mockImplementation(async () => '4567');

    await expect(
      new ProjectConfigContextField().getValueAsync({ nonInteractive: false })
    ).rejects.toThrow();
  });
});
