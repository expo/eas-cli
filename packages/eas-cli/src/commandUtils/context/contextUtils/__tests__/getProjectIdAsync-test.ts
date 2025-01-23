import { getConfig, getConfigFilePaths, modifyConfigAsync } from '@expo/config';
import { vol } from 'memfs';
import { anything, instance, mock, when } from 'ts-mockito';

import { Role } from '../../../../graphql/generated';
import { AppQuery } from '../../../../graphql/queries/AppQuery';
import { learnMore } from '../../../../log';
import { fetchOrCreateProjectIDForWriteToConfigWithConfirmationAsync } from '../../../../project/fetchOrCreateProjectIDForWriteToConfigWithConfirmationAsync';
import { isExpoInstalled } from '../../../../project/projectUtils';
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
jest.mock('../../../../project/projectUtils');

describe(getProjectIdAsync, () => {
  let sessionManager: SessionManager;

  beforeEach(() => {
    jest
      .mocked(getConfigFilePaths)
      .mockReturnValue({ staticConfigPath: null, dynamicConfigPath: null });

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
        preferences: {},
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
    jest.mocked(isExpoInstalled).mockReturnValue(true);
  });

  it('gets the project ID from app config if exists', async () => {
    jest.mocked(getConfig).mockReturnValue({
      exp: {
        sdkVersion: '52.0.0',
        name: 'test',
        slug: 'test',
        extra: { eas: { projectId: '1234' } },
      },
    } as any);
    jest.mocked(AppQuery.byIdAsync).mockResolvedValue({
      id: '1234',
      fullName: '@notnotbrent/test',
      name: 'test',
      slug: 'test',
      ownerAccount: { name: 'notnotbrent' } as any,
    });

    await expect(
      getProjectIdAsync(
        sessionManager,
        { sdkVersion: '52.0.0', name: 'test', slug: 'test', extra: { eas: { projectId: '1234' } } },
        { nonInteractive: false }
      )
    ).resolves.toEqual('1234');
  });

  it('throws when the owner is out of sync', async () => {
    jest.mocked(getConfig).mockReturnValue({
      exp: {
        sdkVersion: '54.0.0',
        name: 'test',
        slug: 'test',
        owner: 'wat',
        extra: { eas: { projectId: '1234' } },
      },
    } as any);
    jest.mocked(AppQuery.byIdAsync).mockResolvedValue({
      id: '1234',
      fullName: '@notnotbrent/test',
      name: 'test',
      slug: 'test',
      ownerAccount: { name: 'notnotbrent' } as any,
    });

    await expect(
      getProjectIdAsync(
        sessionManager,
        {
          sdkVersion: '52.0.0',
          name: 'test',
          slug: 'test',
          owner: 'wat',
          extra: { eas: { projectId: '1234' } },
        },
        { nonInteractive: false }
      )
    ).rejects.toThrow(
      `Project config: Owner of project identified by "extra.eas.projectId" (notnotbrent) does not match owner specified in the "owner" field (wat). ${learnMore(
        'https://expo.fyi/eas-project-id'
      )}`
    );
  });

  describe('when sdkVersion is less than 53', () => {
    it('throws when the owner is not specified and is different than logged in user', async () => {
      jest.mocked(getConfig).mockReturnValue({
        exp: {
          sdkVersion: '52.0.0',
          name: 'test',
          slug: 'test',
          extra: { eas: { projectId: '1234' } },
        },
      } as any);
      jest.mocked(AppQuery.byIdAsync).mockResolvedValue({
        id: '1234',
        fullName: '@totallybrent/test',
        name: 'test',
        slug: 'test',
        ownerAccount: { name: 'totallybrent' } as any,
      });

      await expect(
        getProjectIdAsync(
          sessionManager,
          {
            sdkVersion: '52.0.0',
            name: 'test',
            slug: 'test',
            extra: { eas: { projectId: '1234' } },
          },
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
        exp: {
          sdkVersion: '52.0.0',
          name: 'test',
          slug: 'test',
          extra: { eas: { projectId: '1234' } },
        },
      } as any);
      jest.mocked(AppQuery.byIdAsync).mockResolvedValue({
        id: '1234',
        fullName: '@totallybrent/test',
        name: 'test',
        slug: 'test',
        ownerAccount: { name: 'totallybrent' } as any,
      });

      await expect(
        getProjectIdAsync(
          sessionManagerRobot,
          {
            sdkVersion: '52.0.0',
            name: 'test',
            slug: 'test',
            extra: { eas: { projectId: '1234' } },
          },
          { nonInteractive: false }
        )
      ).rejects.toThrow(
        `Project config: Owner of project identified by "extra.eas.projectId" (totallybrent) must be specified in "owner" field when using a robot access token. To ensure all libraries work correctly, "owner": "totallybrent" should be added to the project config, which can be done automatically by re-running "eas init". ${learnMore(
          'https://expo.fyi/eas-project-id'
        )}`
      );
    });
  });

  describe('when sdkVersion is 53 or higher', () => {
    it('does not throw when the owner is not specified', async () => {
      jest.mocked(getConfig).mockReturnValue({
        exp: {
          sdkVersion: '53.0.0',
          name: 'test',
          slug: 'test',
          extra: { eas: { projectId: '1234' } },
        },
      } as any);
      jest.mocked(AppQuery.byIdAsync).mockResolvedValue({
        id: '1234',
        fullName: '@totallybrent/test',
        name: 'test',
        slug: 'test',
        ownerAccount: { name: 'totallybrent' } as any,
      });

      await expect(
        getProjectIdAsync(
          sessionManager,
          {
            sdkVersion: '53.0.0',
            name: 'test',
            slug: 'test',
            extra: { eas: { projectId: '1234' } },
          },
          { nonInteractive: false }
        )
      ).resolves.not.toThrow();
    });
  });

  it('throws when the slug is out of sync', async () => {
    jest.mocked(getConfig).mockReturnValue({
      exp: {
        sdkVersion: '52.0.0',
        name: 'test',
        slug: 'wat',
        extra: { eas: { projectId: '1234' } },
      },
    } as any);
    jest.mocked(AppQuery.byIdAsync).mockResolvedValue({
      id: '1234',
      fullName: '@notnotbrent/test',
      name: 'test',
      slug: 'test',
      ownerAccount: { name: 'notnotbrent' } as any,
    });

    await expect(
      getProjectIdAsync(
        sessionManager,
        { sdkVersion: '52.0.0', name: 'test', slug: 'wat', extra: { eas: { projectId: '1234' } } },
        { nonInteractive: false }
      )
    ).rejects.toThrow(
      `Project config: Slug for project identified by "extra.eas.projectId" (test) does not match the "slug" field (wat). ${learnMore(
        'https://expo.fyi/eas-project-id'
      )}`
    );
  });

  it('fetches the project ID when not in app config, and sets it in the config', async () => {
    jest
      .mocked(getConfig)
      .mockReturnValue({ exp: { sdkVersion: '52.0.0', name: 'test', slug: 'test' } } as any);
    jest.mocked(modifyConfigAsync).mockResolvedValue({
      type: 'success',
      config: {
        sdkVersion: '52.0.0',
        name: 'test',
        slug: 'test',
        extra: { eas: { projectId: '2345' } },
      },
    });
    jest
      .mocked(fetchOrCreateProjectIDForWriteToConfigWithConfirmationAsync)
      .mockImplementation(async () => '2345');

    const projectId = await getProjectIdAsync(
      sessionManager,
      { sdkVersion: '52.0.0', name: 'test', slug: 'test' },
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
    jest
      .mocked(getConfig)
      .mockReturnValue({ exp: { sdkVersion: '52.0.0', name: 'test', slug: 'test' } } as any);
    jest.mocked(modifyConfigAsync).mockResolvedValue({
      type: 'fail',
      config: null,
    });
    jest
      .mocked(fetchOrCreateProjectIDForWriteToConfigWithConfirmationAsync)
      .mockImplementation(async () => '4567');

    await expect(
      getProjectIdAsync(
        sessionManager,
        { sdkVersion: '52.0.0', name: 'test', slug: 'test' },
        { nonInteractive: false }
      )
    ).rejects.toThrow();
  });

  it('throws if extra.eas.projectId is not a string', async () => {
    jest.mocked(getConfig).mockReturnValue({
      exp: {
        sdkVersion: '52.0.0',
        name: 'test',
        slug: 'test',
        extra: { eas: { projectId: 1234 } },
      },
    } as any);
    jest.mocked(AppQuery.byIdAsync).mockResolvedValue({
      id: '1234',
      fullName: '@notnotbrent/test',
      name: 'test',
      slug: 'test',
      ownerAccount: { name: 'notnotbrent' } as any,
    });

    await expect(
      getProjectIdAsync(
        sessionManager,
        { sdkVersion: '52.0.0', name: 'test', slug: 'wat', extra: { eas: { projectId: 1234 } } },
        { nonInteractive: false }
      )
    ).rejects.toThrow(
      `Project config: "extra.eas.projectId" must be a string, found number. If you're not sure how to set it up on your own, remove the property entirely and it will be automatically configured on the next EAS CLI run.`
    );
  });
});
