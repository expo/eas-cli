import { AppJSONConfig, PackageJSONConfig, getConfig } from '@expo/config';
import chalk from 'chalk';
import { vol } from 'memfs';
import { instance, mock } from 'ts-mockito';

import { getMockOclifConfig } from '../../../__tests__/commands/utils';
import LoggedInContextField from '../../../commandUtils/context/LoggedInContextField';
import ProjectDirContextField from '../../../commandUtils/context/ProjectDirContextField';
import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { saveProjectIdToAppConfigAsync } from '../../../commandUtils/context/contextUtils/getProjectIdAsync';
import FeatureGateEnvOverrides from '../../../commandUtils/gating/FeatureGateEnvOverrides';
import FeatureGating from '../../../commandUtils/gating/FeatureGating';
import { jester, jester2 } from '../../../credentials/__tests__/fixtures-constants';
import { AppMutation } from '../../../graphql/mutations/AppMutation';
import { AppQuery } from '../../../graphql/queries/AppQuery';
import { createOrModifyExpoConfigAsync } from '../../../project/expoConfig';
import { findProjectIdByAccountNameAndSlugNullableAsync } from '../../../project/fetchOrCreateProjectIDForWriteToConfigWithConfirmationAsync';
import { isExpoInstalled } from '../../../project/projectUtils';
import { confirmAsync, promptAsync } from '../../../prompts';
import ProjectInit from '../init';

jest.mock('fs');
jest.mock('@expo/config');
jest.mock('../../../project/expoConfig', () => ({
  ...jest.requireActual('../../../project/expoConfig'),
  createOrModifyExpoConfigAsync: jest.fn(),
}));
jest.mock('../../../prompts');
jest.mock('../../../user/actions');
jest.mock('../../../graphql/mutations/AppMutation');
jest.mock('../../../graphql/queries/AppQuery');
jest.mock('../../../ora', () => ({
  ora: () => ({
    start: () => ({ succeed: () => {}, fail: () => {} }),
  }),
}));
jest.mock('../../../project/fetchOrCreateProjectIDForWriteToConfigWithConfirmationAsync');
jest.mock('../../../commandUtils/context/contextUtils/getProjectIdAsync');
jest.mock('../../../project/projectUtils');

let originalProcessArgv: string[];

beforeAll(() => {
  originalProcessArgv = process.argv;
  process.argv = [];
});

afterAll(() => {
  process.argv = originalProcessArgv;
});

function mockTestProject(options: {
  configuredProjectId?: string;
  configuredOwner?: string;
}): void {
  const projectRoot = '/test-project';
  const packageJSON: PackageJSONConfig = {
    name: 'testing123',
    version: '0.1.0',
    description: 'fake description',
    main: 'index.js',
  };

  const appJSON: AppJSONConfig = {
    expo: {
      name: 'testing 123',
      version: '0.1.0',
      slug: 'testing-123',
      sdkVersion: '33.0.0',
      owner: options.configuredOwner,
      extra: {
        eas: {
          projectId: options.configuredProjectId,
        },
      },
    },
  };

  vol.fromJSON(
    {
      [projectRoot + '/package.json']: JSON.stringify(packageJSON, null, 2),
      [projectRoot + '/app.json']: JSON.stringify(appJSON, null, 2),
    },
    '/'
  );

  const mockManifest = { exp: appJSON.expo };
  const graphqlClient = instance(mock<ExpoGraphqlClient>());

  jest.mocked(getConfig).mockReturnValue(mockManifest as any);
  jest.spyOn(ProjectDirContextField.prototype, 'getValueAsync').mockResolvedValue('/test-project');
  jest.spyOn(LoggedInContextField.prototype, 'getValueAsync').mockResolvedValue({
    actor: jester,
    featureGating: new FeatureGating({}, new FeatureGateEnvOverrides()),
    graphqlClient,
    authenticationInfo: { accessToken: null, sessionSecret: '1234' },
  });

  // NOTE(@kitten): Updating this test is easiest by letting it fallback to `@expo/config`
  // This isn't a great solution, but the test is pretty involved
  jest.mocked(isExpoInstalled).mockReturnValue(false);
}

const commandOptions = getMockOclifConfig({ root: '/test-project' });

beforeEach(() => {
  jest.resetAllMocks();
});

describe(ProjectInit.name, () => {
  describe('when id flag is provided', () => {
    describe('when it is already configured', () => {
      beforeEach(() => {
        mockTestProject({ configuredProjectId: '1234', configuredOwner: jester.accounts[0].name });
      });

      describe('interactive', () => {
        it('is no-op if already configured for id', async () => {
          jest.mocked(AppQuery.byIdAsync).mockResolvedValue({
            id: '1234',
            name: 'testing-123',
            slug: 'testing-123',
            fullName: '@jester/testing-123',
            ownerAccount: jester.accounts[0],
          });
          await new ProjectInit(['--id', '1234'], commandOptions).run();
          expect(saveProjectIdToAppConfigAsync).not.toHaveBeenCalled();
        });

        it('prompts to overwrite when different', async () => {
          jest.mocked(AppQuery.byIdAsync).mockResolvedValue({
            id: '1234',
            name: 'testing-123',
            slug: 'testing-123',
            fullName: '@jester/testing-123',
            ownerAccount: jester.accounts[0],
          });
          jest.mocked(confirmAsync).mockResolvedValue(true);
          await new ProjectInit(['--id', '12345'], commandOptions).run();
          expect(saveProjectIdToAppConfigAsync).toHaveBeenCalledWith('/test-project', '12345');
          expect(confirmAsync).toHaveBeenCalled();
        });

        it('aborts when prompt to overwrite is declined', async () => {
          jest.mocked(AppQuery.byIdAsync).mockResolvedValue({
            id: '1234',
            slug: 'testing-123',
            name: 'testing-123',
            fullName: '@jester/testing-123',
            ownerAccount: jester.accounts[0],
          });
          jest.mocked(confirmAsync).mockResolvedValue(false);
          await expect(
            new ProjectInit(['--id', '12345'], commandOptions).run()
          ).rejects.toThrowError('Aborting');
          expect(saveProjectIdToAppConfigAsync).not.toHaveBeenCalled();
          expect(confirmAsync).toHaveBeenCalled();
        });
      });

      describe('force', () => {
        beforeEach(() => {
          jest.mocked(AppQuery.byIdAsync).mockResolvedValue({
            id: '1234',
            slug: 'testing-123',
            name: 'testing-123',
            fullName: '@jester/testing-123',
            ownerAccount: jester.accounts[0],
          });
        });

        it('does not prompt to overwrite when different', async () => {
          await new ProjectInit(
            ['--id', '12345', '--force'],
            getMockOclifConfig({ root: '/test-project' })
          ).run();
          expect(saveProjectIdToAppConfigAsync).toHaveBeenCalledWith('/test-project', '12345');
          expect(confirmAsync).not.toHaveBeenCalled();
        });
      });

      describe('non-interactive', () => {
        it('aborts when different', async () => {
          await expect(
            new ProjectInit(
              ['--id', '12345', '--non-interactive'],
              getMockOclifConfig({ root: '/test-project' })
            ).run()
          ).rejects.toThrowError(
            `Project is already linked to a different ID: ${chalk.bold(
              '1234'
            )}. Use --force flag to overwrite.`
          );
          expect(saveProjectIdToAppConfigAsync).not.toHaveBeenCalled();
        });
      });

      describe('checks owner and slug consistency', () => {
        it('is a no-op if already consistent', async () => {
          jest.mocked(AppQuery.byIdAsync).mockResolvedValue({
            id: '1234',
            slug: 'testing-123',
            name: 'testing-123',
            fullName: '@jester/testing-123',
            ownerAccount: jester.accounts[0],
          });

          await new ProjectInit(['--id', '1234'], commandOptions).run();
          expect(createOrModifyExpoConfigAsync).not.toHaveBeenCalled();
        });

        it('prompts to configure if not consistent', async () => {
          jest.mocked(AppQuery.byIdAsync).mockResolvedValue({
            id: '1234',
            slug: 'testing-124',
            name: 'testing-123',
            fullName: '@jester2/testing-124',
            ownerAccount: jester2.accounts[0],
          });

          jest.mocked(confirmAsync).mockResolvedValue(true);
          jest
            .mocked(createOrModifyExpoConfigAsync)
            .mockResolvedValue({ type: 'success', config: {} as any });

          await new ProjectInit(['--id', '1234'], commandOptions).run();

          expect(confirmAsync).toHaveBeenCalled();
          expect(createOrModifyExpoConfigAsync).toHaveBeenCalledTimes(2);
          expect(createOrModifyExpoConfigAsync).toHaveBeenCalledWith('/test-project', {
            owner: 'jester2',
          });
          expect(createOrModifyExpoConfigAsync).toHaveBeenCalledWith('/test-project', {
            slug: 'testing-124',
          });
        });

        it('overrides if force flag is present and it is not consistent', async () => {
          jest.mocked(AppQuery.byIdAsync).mockResolvedValue({
            id: '1234',
            slug: 'testing-124',
            name: 'testing-123',
            fullName: '@jester2/testing-124',
            ownerAccount: jester2.accounts[0],
          });

          jest
            .mocked(createOrModifyExpoConfigAsync)
            .mockResolvedValue({ type: 'success', config: {} as any });

          await new ProjectInit(['--id', '1234', '--force'], commandOptions).run();

          expect(confirmAsync).not.toHaveBeenCalled();
          expect(createOrModifyExpoConfigAsync).toHaveBeenCalledTimes(2);
          expect(createOrModifyExpoConfigAsync).toHaveBeenCalledWith('/test-project', {
            owner: 'jester2',
          });
          expect(createOrModifyExpoConfigAsync).toHaveBeenCalledWith('/test-project', {
            slug: 'testing-124',
          });
        });

        it('throws if non-interactive is present and it is not consistent', async () => {
          jest.mocked(AppQuery.byIdAsync).mockResolvedValue({
            id: '1234',
            slug: 'testing-124',
            name: 'testing-123',
            fullName: '@jester2/testing-124',
            ownerAccount: jester2.accounts[0],
          });

          jest
            .mocked(createOrModifyExpoConfigAsync)
            .mockResolvedValue({ type: 'success', config: {} as any });

          await expect(
            new ProjectInit(['--id', '1234', '--non-interactive'], commandOptions).run()
          ).rejects.toThrow(
            'Project config error: Project owner (jester2) does not match the value configured in the "owner" field (jester). Use --force flag to overwrite.'
          );

          expect(confirmAsync).not.toHaveBeenCalled();
          expect(createOrModifyExpoConfigAsync).not.toHaveBeenCalled();
        });
      });
    });

    describe('when it is not yet configured', () => {
      it('configures', async () => {
        mockTestProject({ configuredOwner: jester.accounts[0].name });
        jest.mocked(AppQuery.byIdAsync).mockResolvedValue({
          id: '1234',
          slug: 'testing-123',
          name: 'testing-123',
          fullName: '@jester/testing-123',
          ownerAccount: jester.accounts[0],
        });

        await new ProjectInit(['--id', '1234'], commandOptions).run();
        expect(saveProjectIdToAppConfigAsync).toHaveBeenCalledWith('/test-project', '1234');
      });

      describe('checks owner and slug consistency', () => {
        it('is a no-op if already consistent', async () => {
          mockTestProject({ configuredOwner: jester.accounts[0].name });

          jest.mocked(AppQuery.byIdAsync).mockResolvedValue({
            id: '1234',
            slug: 'testing-123',
            name: 'testing-123',
            fullName: '@jester/testing-123',
            ownerAccount: jester.accounts[0],
          });

          await new ProjectInit(['--id', '1234'], commandOptions).run();
          expect(createOrModifyExpoConfigAsync).not.toHaveBeenCalled();
        });

        it('prompts to configure if not consistent', async () => {
          mockTestProject({ configuredOwner: jester.accounts[0].name });

          jest.mocked(AppQuery.byIdAsync).mockResolvedValue({
            id: '1234',
            slug: 'testing-124',
            name: 'testing-123',
            fullName: '@jester2/testing-124',
            ownerAccount: jester2.accounts[0],
          });

          jest.mocked(confirmAsync).mockResolvedValue(true);
          jest
            .mocked(createOrModifyExpoConfigAsync)
            .mockResolvedValue({ type: 'success', config: {} as any });

          await new ProjectInit(['--id', '1234'], commandOptions).run();

          expect(confirmAsync).toHaveBeenCalled();
          expect(createOrModifyExpoConfigAsync).toHaveBeenCalledTimes(2);
          expect(createOrModifyExpoConfigAsync).toHaveBeenCalledWith('/test-project', {
            owner: 'jester2',
          });
          expect(createOrModifyExpoConfigAsync).toHaveBeenCalledWith('/test-project', {
            slug: 'testing-124',
          });
        });

        it('overrides if force flag is present and it is not consistent', async () => {
          mockTestProject({ configuredOwner: jester.accounts[0].name });

          jest.mocked(AppQuery.byIdAsync).mockResolvedValue({
            id: '1234',
            slug: 'testing-124',
            name: 'testing-123',
            fullName: '@jester2/testing-124',
            ownerAccount: jester2.accounts[0],
          });

          jest
            .mocked(createOrModifyExpoConfigAsync)
            .mockResolvedValue({ type: 'success', config: {} as any });

          await new ProjectInit(['--id', '1234', '--force'], commandOptions).run();

          expect(confirmAsync).not.toHaveBeenCalled();
          expect(createOrModifyExpoConfigAsync).toHaveBeenCalledTimes(2);
          expect(createOrModifyExpoConfigAsync).toHaveBeenCalledWith('/test-project', {
            owner: 'jester2',
          });
          expect(createOrModifyExpoConfigAsync).toHaveBeenCalledWith('/test-project', {
            slug: 'testing-124',
          });
        });

        it('throws if non-interactive is present and it is not consistent', async () => {
          mockTestProject({ configuredOwner: jester.accounts[0].name });

          jest.mocked(AppQuery.byIdAsync).mockResolvedValue({
            id: '1234',
            slug: 'testing-124',
            name: 'testing-123',
            fullName: '@jester2/testing-124',
            ownerAccount: jester2.accounts[0],
          });

          jest
            .mocked(createOrModifyExpoConfigAsync)
            .mockResolvedValue({ type: 'success', config: {} as any });

          await expect(
            new ProjectInit(['--id', '1234', '--non-interactive'], commandOptions).run()
          ).rejects.toThrow(
            'Project config error: Project owner (jester2) does not match the value configured in the "owner" field (jester). Use --force flag to overwrite.'
          );

          expect(confirmAsync).not.toHaveBeenCalled();
          expect(createOrModifyExpoConfigAsync).not.toHaveBeenCalled();
        });
      });
    });
  });

  describe('when no arguments are provided', () => {
    describe('when it is already configured', () => {
      beforeEach(() => {
        mockTestProject({ configuredProjectId: '1234', configuredOwner: jester.accounts[0].name });

        jest.mocked(AppQuery.byIdAsync).mockResolvedValue({
          id: '1234',
          slug: 'testing-123',
          name: 'testing-123',
          fullName: '@jester/testing-123',
          ownerAccount: jester.accounts[0],
        });
      });

      it('does not configure', async () => {
        await new ProjectInit([], commandOptions).run();
        expect(saveProjectIdToAppConfigAsync).not.toHaveBeenCalled();
      });

      it('checks owner and slug consistency', async () => {
        jest.mocked(AppQuery.byIdAsync).mockResolvedValue({
          id: '1234',
          slug: 'testing-124',
          name: 'testing-123',
          fullName: '@jester2/testing-124',
          ownerAccount: jester2.accounts[0],
        });

        jest.mocked(confirmAsync).mockResolvedValue(true);
        jest
          .mocked(createOrModifyExpoConfigAsync)
          .mockResolvedValue({ type: 'success', config: {} as any });

        await new ProjectInit([], commandOptions).run();

        expect(confirmAsync).toHaveBeenCalled();
        expect(createOrModifyExpoConfigAsync).toHaveBeenCalledTimes(2);
        expect(createOrModifyExpoConfigAsync).toHaveBeenCalledWith('/test-project', {
          owner: 'jester2',
        });
        expect(createOrModifyExpoConfigAsync).toHaveBeenCalledWith('/test-project', {
          slug: 'testing-124',
        });
      });
    });

    describe('when it is not yet configured', () => {
      describe('when owner is specified', () => {
        beforeEach(() => {
          mockTestProject({ configuredOwner: jester.accounts[0].name });
        });

        describe('when project exists on server', () => {
          beforeEach(() => {
            jest.mocked(findProjectIdByAccountNameAndSlugNullableAsync).mockResolvedValue('123456');
          });

          it('prompts for confirmation to link', async () => {
            jest.mocked(confirmAsync).mockResolvedValue(true);

            jest.mocked(AppQuery.byIdAsync).mockResolvedValue({
              id: '1234',
              slug: 'testing-123',
              name: 'testing-123',
              fullName: '@jester/testing-123',
              ownerAccount: jester.accounts[0],
            });

            await new ProjectInit([], commandOptions).run();
            expect(saveProjectIdToAppConfigAsync).toHaveBeenCalledWith('/test-project', '123456');
            expect(confirmAsync).toHaveBeenCalledTimes(1);
          });

          it('does not save when confirmation to link is denied', async () => {
            jest.mocked(confirmAsync).mockResolvedValue(false);
            await expect(new ProjectInit([], commandOptions).run()).rejects.toThrow(
              'Project ID configuration canceled. Re-run the command to select a different account/project.'
            );
            expect(saveProjectIdToAppConfigAsync).not.toHaveBeenCalled();
            expect(confirmAsync).toHaveBeenCalledTimes(1);
          });
        });

        describe('when project does not exist on server', () => {
          it('asks to create it', async () => {
            jest.mocked(confirmAsync).mockResolvedValue(true);
            jest.mocked(AppMutation.createAppAsync).mockResolvedValue('0129');

            jest.mocked(AppQuery.byIdAsync).mockResolvedValue({
              id: '0129',
              slug: 'testing-123',
              name: 'testing-123',
              fullName: '@jester/testing-123',
              ownerAccount: jester.accounts[0],
            });

            await new ProjectInit([], commandOptions).run();
            expect(saveProjectIdToAppConfigAsync).toHaveBeenCalledWith('/test-project', '0129');
            expect(confirmAsync).toHaveBeenCalledTimes(1);
          });

          it('does not create it if declined', async () => {
            jest.mocked(confirmAsync).mockResolvedValue(false);
            await expect(new ProjectInit([], commandOptions).run()).rejects.toThrowError(
              'Project ID configuration canceled for @jester/testing-123.'
            );
            expect(saveProjectIdToAppConfigAsync).not.toHaveBeenCalled();
            expect(confirmAsync).toHaveBeenCalledTimes(1);
          });
        });
      });

      describe('when owner is not specified', () => {
        beforeEach(() => {
          mockTestProject({});
        });

        it('prompts for an account', async () => {
          jest.mocked(promptAsync).mockResolvedValue({ account: { name: 'other' } });
          await expect(new ProjectInit([], commandOptions).run()).rejects.toThrowError(
            `You don't have permission to create a new project on the other account and no matching project already exists on the account.`
          );
          expect(promptAsync).toHaveBeenCalledTimes(1);
        });
      });

      it('throws when the user does not have permission to create projects on account', async () => {
        mockTestProject({ configuredOwner: jester.accounts[1].name });
        jest.mocked(AppMutation.createAppAsync).mockResolvedValue('0129');
        await expect(new ProjectInit([], commandOptions).run()).rejects.toThrowError(
          `You don't have permission to create a new project on the other account and no matching project already exists on the account.`
        );
        expect(saveProjectIdToAppConfigAsync).not.toHaveBeenCalled();
      });
    });
  });

  describe('when account flag is provided', () => {
    it('uses the specified account without prompting', async () => {
      mockTestProject({});
      jest.mocked(confirmAsync).mockResolvedValue(true);
      jest.mocked(AppMutation.createAppAsync).mockResolvedValue('0129');
      jest
        .mocked(createOrModifyExpoConfigAsync)
        .mockResolvedValue({ type: 'success', config: {} as any });
      jest.mocked(AppQuery.byIdAsync).mockResolvedValue({
        id: '0129',
        slug: 'testing-123',
        name: 'testing-123',
        fullName: '@jester/testing-123',
        ownerAccount: jester.accounts[0],
      });

      await new ProjectInit(['--account', 'jester'], commandOptions).run();

      expect(promptAsync).not.toHaveBeenCalled();
      expect(jest.mocked(AppMutation.createAppAsync).mock.calls[0][1]).toEqual({
        accountId: jester.accounts[0].id,
        projectName: 'testing-123',
      });
      expect(saveProjectIdToAppConfigAsync).toHaveBeenCalledWith('/test-project', '0129');
    });

    it('creates the project non-interactively without requiring --force', async () => {
      mockTestProject({});
      jest.mocked(AppMutation.createAppAsync).mockResolvedValue('0129');
      jest
        .mocked(createOrModifyExpoConfigAsync)
        .mockResolvedValue({ type: 'success', config: {} as any });
      jest.mocked(AppQuery.byIdAsync).mockResolvedValue({
        id: '0129',
        slug: 'testing-123',
        name: 'testing-123',
        fullName: '@jester/testing-123',
        ownerAccount: jester.accounts[0],
      });

      await new ProjectInit(['--account', 'jester', '--non-interactive'], commandOptions).run();

      expect(promptAsync).not.toHaveBeenCalled();
      expect(confirmAsync).not.toHaveBeenCalled();
      expect(saveProjectIdToAppConfigAsync).toHaveBeenCalledWith('/test-project', '0129');
    });

    it('links an existing project non-interactively without requiring --force', async () => {
      mockTestProject({});
      jest.mocked(findProjectIdByAccountNameAndSlugNullableAsync).mockResolvedValue('123456');
      jest
        .mocked(createOrModifyExpoConfigAsync)
        .mockResolvedValue({ type: 'success', config: {} as any });
      jest.mocked(AppQuery.byIdAsync).mockResolvedValue({
        id: '123456',
        slug: 'testing-123',
        name: 'testing-123',
        fullName: '@jester/testing-123',
        ownerAccount: jester.accounts[0],
      });

      await new ProjectInit(['--account', 'jester', '--non-interactive'], commandOptions).run();

      expect(confirmAsync).not.toHaveBeenCalled();
      expect(saveProjectIdToAppConfigAsync).toHaveBeenCalledWith('/test-project', '123456');
    });

    it('throws non-interactively without --account when no owner is set', async () => {
      mockTestProject({});

      await expect(
        new ProjectInit(['--non-interactive'], commandOptions).run()
      ).rejects.toThrowError(
        'You have access to multiple accounts. Choose the account that should own this project with the --account flag:'
      );

      expect(saveProjectIdToAppConfigAsync).not.toHaveBeenCalled();
    });

    it('throws when the account does not exist or is not accessible', async () => {
      mockTestProject({});

      await expect(
        new ProjectInit(['--account', 'nonexistent'], commandOptions).run()
      ).rejects.toThrowError(
        `You are not able to create projects in the "nonexistent" account. Accounts you have permissions to create projects in: jester`
      );

      expect(saveProjectIdToAppConfigAsync).not.toHaveBeenCalled();
    });

    it('throws when the actor only has a view-only role in the account', async () => {
      mockTestProject({});

      await expect(
        new ProjectInit(['--account', 'other'], commandOptions).run()
      ).rejects.toThrowError(
        `You are not able to create projects in the "other" account. Accounts you have permissions to create projects in: jester`
      );

      expect(saveProjectIdToAppConfigAsync).not.toHaveBeenCalled();
    });

    it('is a no-op when the project is already linked to the specified account', async () => {
      mockTestProject({ configuredProjectId: '1234' });
      jest
        .mocked(createOrModifyExpoConfigAsync)
        .mockResolvedValue({ type: 'success', config: {} as any });
      jest.mocked(AppQuery.byIdAsync).mockResolvedValue({
        id: '1234',
        slug: 'testing-123',
        name: 'testing-123',
        fullName: '@jester/testing-123',
        ownerAccount: jester.accounts[0],
      });

      await new ProjectInit(['--account', 'jester'], commandOptions).run();

      expect(saveProjectIdToAppConfigAsync).not.toHaveBeenCalled();
    });

    it('throws when the project is already linked to a different account without --force', async () => {
      mockTestProject({ configuredProjectId: '1234' });
      jest.mocked(AppQuery.byIdAsync).mockResolvedValue({
        id: '1234',
        slug: 'testing-123',
        name: 'testing-123',
        fullName: '@jester2/testing-123',
        ownerAccount: jester2.accounts[0],
      });

      await expect(
        new ProjectInit(['--account', 'jester'], commandOptions).run()
      ).rejects.toThrowError(
        `This project is already linked to @jester2 (ID: 1234). Pass --force to re-link it to a project owned by jester, or remove the "extra.eas.projectId" field from your app config.`
      );

      expect(saveProjectIdToAppConfigAsync).not.toHaveBeenCalled();
    });

    it('re-links to the specified account when the project is already linked to a different account with --force', async () => {
      mockTestProject({ configuredProjectId: '1234' });
      jest.mocked(findProjectIdByAccountNameAndSlugNullableAsync).mockResolvedValue('123456');
      jest
        .mocked(createOrModifyExpoConfigAsync)
        .mockResolvedValue({ type: 'success', config: {} as any });
      jest
        .mocked(AppQuery.byIdAsync)
        // ownership check for the currently linked project
        .mockResolvedValueOnce({
          id: '1234',
          slug: 'testing-123',
          name: 'testing-123',
          fullName: '@jester2/testing-123',
          ownerAccount: jester2.accounts[0],
        })
        // owner/slug consistency check for the newly linked project
        .mockResolvedValue({
          id: '123456',
          slug: 'testing-123',
          name: 'testing-123',
          fullName: '@jester/testing-123',
          ownerAccount: jester.accounts[0],
        });

      await new ProjectInit(['--account', 'jester', '--force'], commandOptions).run();

      expect(confirmAsync).not.toHaveBeenCalled();
      expect(saveProjectIdToAppConfigAsync).toHaveBeenCalledWith('/test-project', '123456');
    });

    it('throws when the account conflicts with the owner field in the app config', async () => {
      mockTestProject({ configuredOwner: jester.accounts[0].name });

      await expect(
        new ProjectInit(['--account', 'other'], commandOptions).run()
      ).rejects.toThrowError(
        `The account specified with --account (other) does not match the "owner" field in your app config (jester). Provide a matching --account or update the "owner" field.`
      );

      expect(saveProjectIdToAppConfigAsync).not.toHaveBeenCalled();
    });
  });
});
