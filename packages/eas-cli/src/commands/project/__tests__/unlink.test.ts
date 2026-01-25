import { AppJSONConfig, PackageJSONConfig, getConfig } from '@expo/config';
import chalk from 'chalk';
import { vol } from 'memfs';
import { instance, mock } from 'ts-mockito';

import MaybeLoggedInContextField from '../../../commandUtils/context/MaybeLoggedInContextField';
import ProjectDirContextField from '../../../commandUtils/context/ProjectDirContextField';
import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import FeatureGateEnvOverrides from '../../../commandUtils/gating/FeatureGateEnvOverrides';
import FeatureGating from '../../../commandUtils/gating/FeatureGating';
import { jester } from '../../../credentials/__tests__/fixtures-constants';
import { AppQuery } from '../../../graphql/queries/AppQuery';
import {
  createOrModifyExpoConfigAsync,
  isUsingStaticExpoConfig,
} from '../../../project/expoConfig';
import { isExpoInstalled } from '../../../project/projectUtils';
import { confirmAsync } from '../../../prompts';
import ProjectUnlink from '../unlink';

jest.mock('fs');
jest.mock('@expo/config');
jest.mock('../../../project/expoConfig', () => ({
  ...jest.requireActual('../../../project/expoConfig'),
  createOrModifyExpoConfigAsync: jest.fn(),
  isUsingStaticExpoConfig: jest.fn(),
}));
jest.mock('../../../prompts');
jest.mock('../../../user/actions');
jest.mock('../../../graphql/queries/AppQuery');
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
  updatesUrl?: string;
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
      updates: options.updatesUrl ? { url: options.updatesUrl } : undefined,
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
  jest.spyOn(MaybeLoggedInContextField.prototype, 'getValueAsync').mockResolvedValue({
    actor: jester,
    featureGating: new FeatureGating({}, new FeatureGateEnvOverrides()),
    graphqlClient,
    authenticationInfo: { accessToken: null, sessionSecret: '1234' },
  });
  jest.mocked(isExpoInstalled).mockReturnValue(true);
  jest.mocked(isUsingStaticExpoConfig).mockReturnValue(true);
}

const commandOptions = { root: '/test-project' } as any;

beforeEach(() => {
  jest.resetAllMocks();
});

describe(ProjectUnlink.name, () => {
  describe('when project is not linked', () => {
    beforeEach(() => {
      mockTestProject({});
    });

    it('logs message and exits', async () => {
      await new ProjectUnlink([], commandOptions).run();
      expect(createOrModifyExpoConfigAsync).not.toHaveBeenCalled();
    });
  });

  describe('when project is linked', () => {
    const projectId = '1234';

    beforeEach(() => {
      mockTestProject({ configuredProjectId: projectId, configuredOwner: jester.accounts[0].name });
    });

    describe('interactive mode', () => {
      it('prompts for confirmation and unlinks when confirmed', async () => {
        jest.mocked(AppQuery.byIdAsync).mockResolvedValue({
          id: projectId,
          slug: 'testing-123',
          name: 'testing-123',
          fullName: '@jester/testing-123',
          ownerAccount: jester.accounts[0],
        });
        jest.mocked(confirmAsync).mockResolvedValue(true);
        jest
          .mocked(createOrModifyExpoConfigAsync)
          .mockResolvedValue({ type: 'success', config: {} as any });

        await new ProjectUnlink([], commandOptions).run();

        expect(confirmAsync).toHaveBeenCalled();
        expect(createOrModifyExpoConfigAsync).toHaveBeenCalledWith('/test-project', {
          extra: {},
        });
      });

      it('aborts when confirmation is declined', async () => {
        jest.mocked(AppQuery.byIdAsync).mockResolvedValue({
          id: projectId,
          slug: 'testing-123',
          name: 'testing-123',
          fullName: '@jester/testing-123',
          ownerAccount: jester.accounts[0],
        });
        jest.mocked(confirmAsync).mockResolvedValue(false);

        await new ProjectUnlink([], commandOptions).run();

        expect(confirmAsync).toHaveBeenCalled();
        expect(createOrModifyExpoConfigAsync).not.toHaveBeenCalled();
      });
    });

    describe('with --force flag', () => {
      it('skips confirmation prompt', async () => {
        jest.mocked(AppQuery.byIdAsync).mockResolvedValue({
          id: projectId,
          slug: 'testing-123',
          name: 'testing-123',
          fullName: '@jester/testing-123',
          ownerAccount: jester.accounts[0],
        });
        jest
          .mocked(createOrModifyExpoConfigAsync)
          .mockResolvedValue({ type: 'success', config: {} as any });

        await new ProjectUnlink(['--force'], commandOptions).run();

        expect(confirmAsync).not.toHaveBeenCalled();
        expect(createOrModifyExpoConfigAsync).toHaveBeenCalled();
      });
    });

    describe('non-interactive mode', () => {
      it('throws error without --force flag', async () => {
        await expect(
          new ProjectUnlink(['--non-interactive'], commandOptions).run()
        ).rejects.toThrowError(
          `This project is linked to ${chalk.bold(
            projectId
          )}. Use --force flag to unlink in non-interactive mode.`
        );
        expect(createOrModifyExpoConfigAsync).not.toHaveBeenCalled();
      });

      it('works with --force flag', async () => {
        jest
          .mocked(createOrModifyExpoConfigAsync)
          .mockResolvedValue({ type: 'success', config: {} as any });

        await new ProjectUnlink(['--non-interactive', '--force'], commandOptions).run();

        expect(confirmAsync).not.toHaveBeenCalled();
        expect(createOrModifyExpoConfigAsync).toHaveBeenCalled();
      });
    });

    describe('with EAS updates URL', () => {
      beforeEach(() => {
        mockTestProject({
          configuredProjectId: projectId,
          configuredOwner: jester.accounts[0].name,
          updatesUrl: 'https://u.expo.dev/1234',
        });
      });

      it('removes updates.url when it matches EAS pattern', async () => {
        jest.mocked(confirmAsync).mockResolvedValue(true);
        jest
          .mocked(createOrModifyExpoConfigAsync)
          .mockResolvedValue({ type: 'success', config: {} as any });

        await new ProjectUnlink([], commandOptions).run();

        expect(createOrModifyExpoConfigAsync).toHaveBeenCalledWith('/test-project', {
          extra: {},
          updates: undefined,
        });
      });
    });

    describe('with staging EAS updates URL', () => {
      beforeEach(() => {
        mockTestProject({
          configuredProjectId: projectId,
          configuredOwner: jester.accounts[0].name,
          updatesUrl: 'https://staging-u.expo.dev/1234',
        });
      });

      it('removes staging updates.url', async () => {
        jest.mocked(confirmAsync).mockResolvedValue(true);
        jest
          .mocked(createOrModifyExpoConfigAsync)
          .mockResolvedValue({ type: 'success', config: {} as any });

        await new ProjectUnlink([], commandOptions).run();

        expect(createOrModifyExpoConfigAsync).toHaveBeenCalledWith('/test-project', {
          extra: {},
          updates: undefined,
        });
      });
    });

    describe('with non-EAS updates URL', () => {
      beforeEach(() => {
        mockTestProject({
          configuredProjectId: projectId,
          configuredOwner: jester.accounts[0].name,
          updatesUrl: 'https://custom-updates.example.com',
        });
      });

      it('does not remove custom updates.url', async () => {
        jest.mocked(confirmAsync).mockResolvedValue(true);
        jest
          .mocked(createOrModifyExpoConfigAsync)
          .mockResolvedValue({ type: 'success', config: {} as any });

        await new ProjectUnlink([], commandOptions).run();

        expect(createOrModifyExpoConfigAsync).toHaveBeenCalledWith('/test-project', {
          extra: {},
        });
      });
    });

    describe('with dynamic config', () => {
      beforeEach(() => {
        mockTestProject({
          configuredProjectId: projectId,
          configuredOwner: jester.accounts[0].name,
        });
        jest.mocked(isUsingStaticExpoConfig).mockReturnValue(false);
      });

      it('throws error with helpful message', async () => {
        jest.mocked(confirmAsync).mockResolvedValue(true);

        await expect(new ProjectUnlink([], commandOptions).run()).rejects.toThrowError(
          'Cannot automatically modify dynamic app configuration.'
        );
        expect(createOrModifyExpoConfigAsync).not.toHaveBeenCalled();
      });
    });
  });

  describe('when logged out', () => {
    beforeEach(() => {
      mockTestProject({ configuredProjectId: '1234' });
      jest.spyOn(MaybeLoggedInContextField.prototype, 'getValueAsync').mockResolvedValue({
        actor: null,
        featureGating: new FeatureGating({}, new FeatureGateEnvOverrides()),
        graphqlClient: instance(mock<ExpoGraphqlClient>()),
        authenticationInfo: { accessToken: null, sessionSecret: null },
      });
    });

    it('shows project ID in confirmation since it cannot fetch project name', async () => {
      jest.mocked(confirmAsync).mockResolvedValue(true);
      jest
        .mocked(createOrModifyExpoConfigAsync)
        .mockResolvedValue({ type: 'success', config: {} as any });

      await new ProjectUnlink([], commandOptions).run();

      expect(confirmAsync).toHaveBeenCalledWith({
        message: expect.stringContaining('1234'),
      });
    });
  });
});
