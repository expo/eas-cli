import { AppJSONConfig, ExpoConfig, PackageJSONConfig, getConfig } from '@expo/config';
import { Updates } from '@expo/config-plugins';
import { vol } from 'memfs';
import nullthrows from 'nullthrows';
import path from 'path';
import { instance, mock } from 'ts-mockito';

import { ensureBranchExistsAsync } from '../../../branch/queries';
import {
  DynamicPrivateProjectConfigContextField,
  DynamicPublicProjectConfigContextField,
} from '../../../commandUtils/context/DynamicProjectConfigContextField';
import LoggedInContextField from '../../../commandUtils/context/LoggedInContextField';
import VcsClientContextField from '../../../commandUtils/context/VcsClientContextField';
import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import FeatureGateEnvOverrides from '../../../commandUtils/gating/FeatureGateEnvOverrides';
import FeatureGating from '../../../commandUtils/gating/FeatureGating';
import { jester } from '../../../credentials/__tests__/fixtures-constants';
import { UpdateFragment } from '../../../graphql/generated';
import { PublishMutation } from '../../../graphql/mutations/PublishMutation';
import { AppQuery } from '../../../graphql/queries/AppQuery';
import { getBranchNameFromChannelNameAsync } from '../../../update/getBranchNameFromChannelNameAsync';
import { resolveVcsClient } from '../../../vcs';
import UpdateRollBackToEmbedded from '../roll-back-to-embedded';

const projectRoot = '/test-project';
const commandOptions = { root: projectRoot } as any;
const updateStub: UpdateFragment = {
  id: 'update-1234',
  group: 'group-1234',
  branch: { id: 'branch-1234', name: 'main' },
  message: 'test message',
  runtimeVersion: 'exposdk:47.0.0',
  platform: 'ios',
  gitCommitHash: 'commit',
  manifestFragment: JSON.stringify({ fake: 'manifest' }),
  isRollBackToEmbedded: false,
  manifestPermalink: 'https://expo.dev/fake/manifest/link',
  codeSigningInfo: null,
  createdAt: '2022-01-01T12:00:00Z',
};

jest.mock('fs');
jest.mock('@expo/config');
jest.mock('@expo/config-plugins');
jest.mock('../../../branch/queries');
jest.mock('../../../commandUtils/context/contextUtils/getProjectIdAsync');
jest.mock('../../../project/projectUtils', () => ({
  ...jest.requireActual('../../../project/projectUtils'),
  enforceRollBackToEmbeddedUpdateSupportAsync: jest.fn(),
}));
jest.mock('../../../update/configure');
jest.mock('../../../update/getBranchNameFromChannelNameAsync');
jest.mock('../../../graphql/mutations/PublishMutation');
jest.mock('../../../graphql/queries/AppQuery');
jest.mock('../../../graphql/queries/UpdateQuery');
jest.mock('../../../ora', () => ({
  ora: () => ({
    start: () => ({ succeed: () => {}, fail: () => {}, stop: () => {} }),
  }),
}));
jest.mock('../../../project/publish', () => ({
  ...jest.requireActual('../../../project/publish'),
  buildBundlesAsync: jest.fn(),
  collectAssetsAsync: jest.fn(),
  resolveInputDirectoryAsync: jest.fn((inputDir = 'dist') => path.join(projectRoot, inputDir)),
  uploadAssetsAsync: jest.fn(),
}));

describe(UpdateRollBackToEmbedded.name, () => {
  afterEach(() => {
    vol.reset();
  });

  it('errors with both --channel and --branch', async () => {
    const flags = ['--channel=channel123', '--branch=branch123'];

    mockTestProject();

    await expect(new UpdateRollBackToEmbedded(flags, commandOptions).run()).rejects.toThrow(
      'Cannot specify both --channel and --branch. Specify either --channel, --branch, or --auto.'
    );
  });

  it('creates a roll back to embedded with --non-interactive, --branch, and --message', async () => {
    const flags = ['--non-interactive', '--branch=branch123', '--message=abc'];

    mockTestProject();
    const platforms = ['android', 'ios'];
    const runtimeVersion = 'exposdk:47.0.0';
    jest.mocked(Updates.getRuntimeVersionAsync).mockResolvedValue(runtimeVersion);

    jest.mocked(ensureBranchExistsAsync).mockResolvedValue({
      branchId: 'branch123',
      createdBranch: false,
    });

    jest
      .mocked(PublishMutation.publishUpdateGroupAsync)
      .mockResolvedValue(platforms.map(platform => ({ ...updateStub, platform, runtimeVersion })));

    await new UpdateRollBackToEmbedded(flags, commandOptions).run();

    expect(PublishMutation.publishUpdateGroupAsync).toHaveBeenCalled();
  });

  it('creates a roll back to embedded with --non-interactive, --channel, and --message', async () => {
    const flags = ['--non-interactive', '--channel=channel123', '--message=abc'];

    const { projectId } = mockTestProject();
    const platforms = ['android', 'ios'];
    const runtimeVersion = 'exposdk:47.0.0';
    jest.mocked(Updates.getRuntimeVersionAsync).mockResolvedValue(runtimeVersion);

    jest.mocked(getBranchNameFromChannelNameAsync).mockResolvedValue('branchFromChannel');
    jest.mocked(ensureBranchExistsAsync).mockResolvedValue({
      branchId: 'branch123',
      createdBranch: false,
    });

    jest.mocked(PublishMutation.publishUpdateGroupAsync).mockResolvedValue(
      platforms.map(platform => ({
        ...updateStub,
        runtimeVersion,
        platform,
      }))
    );

    await new UpdateRollBackToEmbedded(flags, commandOptions).run();

    expect(ensureBranchExistsAsync).toHaveBeenCalledWith(
      expect.any(Object), // graphql client
      {
        appId: projectId,
        branchName: 'branchFromChannel',
      }
    );

    expect(PublishMutation.publishUpdateGroupAsync).toHaveBeenCalled();
  });

  it('creates a roll back to embedded with the public expo config', async () => {
    const flags = ['--non-interactive', '--branch=branch123', '--message=abc'];

    // Add configuration to the project that should not be included in the update
    mockTestProject({
      expoConfig: {},
    });

    const platforms = ['ios'];
    const runtimeVersion = 'exposdk:47.0.0';
    jest.mocked(Updates.getRuntimeVersionAsync).mockResolvedValue(runtimeVersion);

    // Mock an existing branch, so we don't create a new one
    jest.mocked(ensureBranchExistsAsync).mockResolvedValue({
      branchId: 'branch123',
      createdBranch: false,
    });

    jest
      .mocked(PublishMutation.publishUpdateGroupAsync)
      .mockResolvedValue(platforms.map(platform => ({ ...updateStub, platform, runtimeVersion })));

    await new UpdateRollBackToEmbedded(flags, commandOptions).run();

    // Pull the publish data from the mocked publish function
    const publishData = jest.mocked(PublishMutation.publishUpdateGroupAsync).mock.calls[0][1][0];
    expect(nullthrows(publishData.rollBackToEmbeddedInfoGroup).ios).toBe(true);
  });
});

/** Create a new in-memory project, based on src/commands/project/__tests__/init.test.ts */
function mockTestProject({
  configuredProjectId = '1234',
  expoConfig = {},
}: {
  configuredProjectId?: string;
  expoConfig?: Partial<ExpoConfig>;
} = {}): { projectId: string; appJson: AppJSONConfig } {
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
      owner: jester.accounts[0].name,
      extra: {
        eas: {
          projectId: configuredProjectId,
        },
      },
      ...expoConfig,
    },
  };

  vol.fromJSON(
    {
      'package.json': JSON.stringify(packageJSON),
      'app.json': JSON.stringify(appJSON),
    },
    projectRoot
  );

  const mockManifest = { exp: appJSON.expo };
  const graphqlClient = instance(mock<ExpoGraphqlClient>({}));

  jest.mocked(getConfig).mockReturnValue(mockManifest as any);
  jest
    .spyOn(DynamicPrivateProjectConfigContextField.prototype, 'getValueAsync')
    .mockResolvedValue(async () => {
      const exp = { ...mockManifest.exp };
      return {
        exp,
        projectDir: projectRoot,
        projectId: configuredProjectId,
      };
    });
  jest
    .spyOn(DynamicPublicProjectConfigContextField.prototype, 'getValueAsync')
    .mockResolvedValue(async () => {
      const exp = {
        name: mockManifest.exp.name,
        version: mockManifest.exp.version,
        slug: mockManifest.exp.slug,
        sdkVersion: mockManifest.exp.sdkVersion,
        owner: mockManifest.exp.owner,
        extra: mockManifest.exp.extra,
      };
      return {
        exp,
        projectDir: projectRoot,
        projectId: configuredProjectId,
      };
    });

  jest.spyOn(LoggedInContextField.prototype, 'getValueAsync').mockResolvedValue({
    actor: jester,
    featureGating: new FeatureGating({}, new FeatureGateEnvOverrides()),
    graphqlClient,
  });
  jest
    .spyOn(VcsClientContextField.prototype, 'getValueAsync')
    .mockResolvedValue(resolveVcsClient());

  jest.mocked(AppQuery.byIdAsync).mockResolvedValue({
    id: '1234',
    slug: 'testing-123',
    name: 'testing-123',
    fullName: '@jester/testing-123',
    ownerAccount: jester.accounts[0],
  });

  return { projectId: configuredProjectId, appJson: appJSON };
}
