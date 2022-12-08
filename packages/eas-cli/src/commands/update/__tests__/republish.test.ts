import { AppJSONConfig, PackageJSONConfig, getConfig } from '@expo/config';
import { vol } from 'memfs';
import { instance, mock } from 'ts-mockito';

import LoggedInContextField from '../../../commandUtils/context/LoggedInContextField';
import ProjectConfigContextField from '../../../commandUtils/context/ProjectConfigContextField';
import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import FeatureGateEnvOverrides from '../../../commandUtils/gating/FeatureGateEnvOverrides';
import FeatureGating from '../../../commandUtils/gating/FeatureGating';
import { jester } from '../../../credentials/__tests__/fixtures-constants';
import { CodeSigningInfo, UpdateFragment } from '../../../graphql/generated';
import { PublishMutation } from '../../../graphql/mutations/PublishMutation';
import { AppQuery } from '../../../graphql/queries/AppQuery';
import { UpdateQuery } from '../../../graphql/queries/UpdateQuery';
import UpdateRepublish from '../republish';

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
  codeSigningInfo: null,
  createdAt: '2022-01-01T12:00:00Z',
};

const codeSigningStub: CodeSigningInfo = {
  keyid: 'keyid',
  alg: 'alg',
  sig: 'sig',
};

jest.mock('fs');
jest.mock('@expo/config');
jest.mock('../../../commandUtils/context/contextUtils/getProjectIdAsync');
jest.mock('../../../graphql/mutations/PublishMutation');
jest.mock('../../../graphql/queries/AppQuery');
jest.mock('../../../graphql/queries/UpdateQuery');
jest.mock('../../../ora', () => ({
  ora: () => ({
    start: () => ({ succeed: () => {}, fail: () => {} }),
  }),
}));

describe(UpdateRepublish.name, () => {
  it('errors without --branch or --group', async () => {
    await expect(new UpdateRepublish([], commandOptions).run()).rejects.toThrow(
      '--branch or --group must be specified'
    );
  });

  it('errors when update group is empty', async () => {
    const flags = ['--group=1234'];

    mockTestProject();
    jest.mocked(UpdateQuery.viewUpdateGroupAsync).mockResolvedValue([]);

    await expect(new UpdateRepublish(flags, commandOptions).run()).rejects.toThrow(
      'There are no published updates found'
    );
  });

  it('errors when update group has no update for requested platform', async () => {
    const flags = ['--group=1234', '--platform=android'];

    mockTestProject();
    jest.mocked(UpdateQuery.viewUpdateGroupAsync).mockResolvedValue([
      {
        ...updateStub,
        platform: 'ios',
      },
    ]);

    await expect(new UpdateRepublish(flags, commandOptions).run()).rejects.toThrow(
      'There are no updates on branch "main" published for the platform(s) "android" with group ID "1234". Did you mean to publish a new update instead?'
    );
  });

  it('errors when republishing update with both --group and --branch', async () => {
    const flags = ['--group=1234', '--branch=main'];

    mockTestProject();

    await expect(new UpdateRepublish(flags, commandOptions).run()).rejects.toThrow(
      /--branch=main cannot also be provided when using --group/
    );
  });

  it('creates a new update from existing update', async () => {
    const flags = ['--group=1234', '--message=test-republish'];

    mockTestProject();
    // Mock queries to retrieve the update and code signing info
    jest.mocked(UpdateQuery.viewUpdateGroupAsync).mockResolvedValue([updateStub]);
    // Mock mutations to store the new update
    jest.mocked(PublishMutation.publishUpdateGroupAsync).mockResolvedValue([
      {
        ...updateStub,
        id: 'update-new',
        platform: 'ios',
        manifestPermalink: 'https://expo.dev/@test/test-project/manifest',
      },
    ]);

    await new UpdateRepublish(flags, commandOptions).run();

    expect(PublishMutation.publishUpdateGroupAsync).toHaveBeenCalledWith(
      expect.any(Object), // graphql client
      expect.arrayContaining([
        expect.objectContaining({
          branchId: updateStub.branch.id,
          runtimeVersion: updateStub.runtimeVersion,
          updateInfoGroup: expect.objectContaining({
            ios: expect.any(Object),
          }),
          gitCommitHash: updateStub.gitCommitHash,
          awaitingCodeSigningInfo: false,
        }),
      ])
    );

    expect(PublishMutation.setCodeSigningInfoAsync).not.toHaveBeenCalled();
  });

  it('creates a new update from existing update with codesigning', async () => {
    const flags = ['--group=1234', '--message=test-republish'];
    const codeSigning = {
      alg: 'alg',
      keyid: 'keyid',
      sig: 'sig',
    };

    mockTestProject();
    // Mock queries to retrieve the update and code signing info
    jest
      .mocked(UpdateQuery.viewUpdateGroupAsync)
      .mockResolvedValue([{ ...updateStub, codeSigningInfo: codeSigningStub }]);
    // Mock mutations to store the new update
    jest.mocked(PublishMutation.publishUpdateGroupAsync).mockResolvedValue([
      {
        ...updateStub,
        id: 'update-new',
        platform: 'ios',
        manifestPermalink: 'https://expo.dev/@test/test-project/manifest',
      },
    ]);
    jest.mocked(PublishMutation.setCodeSigningInfoAsync).mockResolvedValue({} as any);

    await new UpdateRepublish(flags, commandOptions).run();

    expect(PublishMutation.publishUpdateGroupAsync).toHaveBeenCalledWith(
      expect.any(Object), // graphql client
      expect.arrayContaining([
        expect.objectContaining({
          branchId: updateStub.branch.id,
          runtimeVersion: updateStub.runtimeVersion,
          updateInfoGroup: expect.objectContaining({
            ios: expect.any(Object),
          }),
          gitCommitHash: updateStub.gitCommitHash,
          awaitingCodeSigningInfo: true,
        }),
      ])
    );

    expect(PublishMutation.setCodeSigningInfoAsync).toHaveBeenCalledWith(
      expect.any(Object), // graphql client
      'update-new',
      expect.objectContaining(codeSigning)
    );
  });
});

/** Create a new in-memory project, based on src/commands/project/__tests__/init.test.ts */
function mockTestProject({
  configuredProjectId = '1234',
}: {
  configuredProjectId?: string;
} = {}): void {
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
  jest.spyOn(ProjectConfigContextField.prototype, 'getValueAsync').mockResolvedValue({
    exp: mockManifest.exp,
    projectDir: projectRoot,
    projectId: configuredProjectId,
  });

  jest.spyOn(LoggedInContextField.prototype, 'getValueAsync').mockResolvedValue({
    actor: jester,
    featureGating: new FeatureGating({}, new FeatureGateEnvOverrides()),
    graphqlClient,
  });

  jest.mocked(AppQuery.byIdAsync).mockResolvedValue({
    id: '1234',
    slug: 'testing-123',
    fullName: '@jester/testing-123',
    ownerAccount: jester.accounts[0],
  });
}
