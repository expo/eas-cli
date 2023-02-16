import { getConfig, modifyConfigAsync } from '@expo/config';
import { vol } from 'memfs';
import { anything, instance, mock, when } from 'ts-mockito';

import { Role } from '../../../../graphql/generated';
import { AppQuery } from '../../../../graphql/queries/AppQuery';
import { learnMore } from '../../../../log';
import { fetchOrCreateProjectIDForWriteToConfigWithConfirmationAsync } from '../../../../project/fetchOrCreateProjectIDForWriteToConfigWithConfirmationAsync';
import SessionManager from '../../../../user/SessionManager';
import { findProjectRootAsync } from '../findProjectDirAndVerifyProjectSetupAsync';
import { getProjectIdAsync } from '../getProjectIdAsync';

jest.mock('@expo/config');
jest.mock('fs');

jest.mock('../../../../graphql/queries/AppQuery');
jest.mock('../../contextUtils/findProjectDirAndVerifyProjectSetupAsync');
jest.mock('../../../../ora', () => ({
  ora: () => ({
    start: () => ({ succeed: () => {}, fail: () => {} }),
  }),
}));
jest.mock('../../../../project/fetchOrCreateProjectIDForWriteToConfigWithConfirmationAsync');

describe(getProjectIdAsync, () => {
  let sessionManager: SessionManager;

  beforeEach(() => {
    const sessionManagerMock = mock<SessionManager>();
    when(sessionManagerMock.ensureLoggedInAsync(anything())).thenResolve({
      actor: {
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
        featureGates: {},
      },
      authenticationInfo: { accessToken: 'fake', sessionSecret: null },
    });
    sessionManager = instance(sessionManagerMock);

    vol.fromJSON(
      {
        './README.md': '1',
        './package.json': '2',
        './src/index.ts': '3',
      },
      '/app'
    );

    jest.mocked(findProjectRootAsync).mockResolvedValue('/app');
  });

  it('gets the project ID from app config if exists', async () => {
    jest.mocked(getConfig).mockReturnValue({
      exp: { name: 'test', slug: 'test', extra: { eas: { projectId: '1234' } } },
    } as any);
    jest.mocked(AppQuery.byIdAsync).mockResolvedValue({
      id: '1234',
      fullName: '@notnotbrent/test',
      slug: 'test',
      ownerAccount: { name: 'notnotbrent' } as any,
    });

    await expect(
      getProjectIdAsync(
        sessionManager,
        { name: 'test', slug: 'test', extra: { eas: { projectId: '1234' } } },
        { nonInteractive: false }
      )
    ).resolves.toEqual('1234');
  });

  it('throws when the owner is out of sync', async () => {
    jest.mocked(getConfig).mockReturnValue({
      exp: { name: 'test', slug: 'test', owner: 'wat', extra: { eas: { projectId: '1234' } } },
    } as any);
    jest.mocked(AppQuery.byIdAsync).mockResolvedValue({
      id: '1234',
      fullName: '@notnotbrent/test',
      slug: 'test',
      ownerAccount: { name: 'notnotbrent' } as any,
    });

    await expect(
      getProjectIdAsync(
        sessionManager,
        { name: 'test', slug: 'test', owner: 'wat', extra: { eas: { projectId: '1234' } } },
        { nonInteractive: false }
      )
    ).rejects.toThrow(
      `Project config: Owner of project identified by "extra.eas.projectId" (notnotbrent) does not match owner specified in the "owner" field (wat). ${learnMore(
        'https://expo.fyi/eas-project-id'
      )}`
    );
  });

  it('throws when the owner is not specified and is different than logged in user', async () => {
    jest.mocked(getConfig).mockReturnValue({
      exp: { name: 'test', slug: 'test', extra: { eas: { projectId: '1234' } } },
    } as any);
    jest.mocked(AppQuery.byIdAsync).mockResolvedValue({
      id: '1234',
      fullName: '@totallybrent/test',
      slug: 'test',
      ownerAccount: { name: 'totallybrent' } as any,
    });

    await expect(
      getProjectIdAsync(
        sessionManager,
        { name: 'test', slug: 'test', extra: { eas: { projectId: '1234' } } },
        { nonInteractive: false }
      )
    ).rejects.toThrow(
      `Project config: Owner of project identified by "extra.eas.projectId" (totallybrent) does not match the logged in user (notnotbrent) and the "owner" field is not specified. To ensure all libraries work correctly, "owner": "totallybrent" should be added to the project config, which can be done automatically by re-running "eas init". ${learnMore(
        'https://expo.fyi/eas-project-id'
      )}`
    );
  });

  it('throws when the owner is not specified and is different than logged in user which is a robot', async () => {
    const sessionManagerMock = mock<SessionManager>();
    when(sessionManagerMock.ensureLoggedInAsync(anything())).thenResolve({
      actor: {
        __typename: 'Robot',
        id: 'robot_id',
        accounts: [
          {
            id: 'account_id_1',
            name: 'notnotbrent',
            users: [{ role: Role.Admin, actor: { id: 'robot_id' } }],
          },
          {
            id: 'account_id_2',
            name: 'dominik',
            users: [{ role: Role.ViewOnly, actor: { id: 'robot_id' } }],
          },
        ],
        isExpoAdmin: false,
        featureGates: {},
      },
      authenticationInfo: { accessToken: 'fake', sessionSecret: null },
    });
    const sessionManagerRobot = instance(sessionManagerMock);

    jest.mocked(getConfig).mockReturnValue({
      exp: { name: 'test', slug: 'test', extra: { eas: { projectId: '1234' } } },
    } as any);
    jest.mocked(AppQuery.byIdAsync).mockResolvedValue({
      id: '1234',
      fullName: '@totallybrent/test',
      slug: 'test',
      ownerAccount: { name: 'totallybrent' } as any,
    });

    await expect(
      getProjectIdAsync(
        sessionManagerRobot,
        { name: 'test', slug: 'test', extra: { eas: { projectId: '1234' } } },
        { nonInteractive: false }
      )
    ).rejects.toThrow(
      `Project config: Owner of project identified by "extra.eas.projectId" (totallybrent) must be specified in "owner" field when using a robot access token. To ensure all libraries work correctly, "owner": "totallybrent" should be added to the project config, which can be done automatically by re-running "eas init". ${learnMore(
        'https://expo.fyi/eas-project-id'
      )}`
    );
  });

  it('throws when the slug is out of sync', async () => {
    jest.mocked(getConfig).mockReturnValue({
      exp: { name: 'test', slug: 'wat', extra: { eas: { projectId: '1234' } } },
    } as any);
    jest.mocked(AppQuery.byIdAsync).mockResolvedValue({
      id: '1234',
      fullName: '@notnotbrent/test',
      slug: 'test',
      ownerAccount: { name: 'notnotbrent' } as any,
    });

    await expect(
      getProjectIdAsync(
        sessionManager,
        { name: 'test', slug: 'wat', extra: { eas: { projectId: '1234' } } },
        { nonInteractive: false }
      )
    ).rejects.toThrow(
      `Project config: Slug for project identified by "extra.eas.projectId" (test) does not match the "slug" field (wat). ${learnMore(
        'https://expo.fyi/eas-project-id'
      )}`
    );
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
      sessionManager,
      { name: 'test', slug: 'test' },
      {
        nonInteractive: false,
      }
    );

    expect(projectId).toEqual('2345');

    expect(modifyConfigAsync).toHaveBeenCalledTimes(1);
    expect(modifyConfigAsync).toHaveBeenCalledWith(
      '/app',
      {
        extra: { eas: { projectId: '2345' } },
      },
      { skipSDKVersionRequirement: true }
    );
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
      getProjectIdAsync(sessionManager, { name: 'test', slug: 'test' }, { nonInteractive: false })
    ).rejects.toThrow();
  });
});
