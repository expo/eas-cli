import { AppJSONConfig, ExpoConfig, PackageJSONConfig, getConfig } from '@expo/config';
import { DirectoryJSON, vol } from 'memfs';
import { instance, mock } from 'ts-mockito';

import { getMockOclifConfig } from '../../../__tests__/commands/utils';
import LoggedInContextField from '../../../commandUtils/context/LoggedInContextField';
import { PrivateProjectConfigContextField } from '../../../commandUtils/context/PrivateProjectConfigContextField';
import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import FeatureGateEnvOverrides from '../../../commandUtils/gating/FeatureGateEnvOverrides';
import FeatureGating from '../../../commandUtils/gating/FeatureGating';
import { jester } from '../../../credentials/__tests__/fixtures-constants';
import { UpdateFragment } from '../../../graphql/generated';
import { AppQuery } from '../../../graphql/queries/AppQuery';
import { UpdateQuery } from '../../../graphql/queries/UpdateQuery';
import UpdateRepublish from '../republish';
import UpdateRollBackToEmbedded from '../roll-back-to-embedded';
import UpdateRollback from '../rollback';

const projectRoot = '/test-project';
const commandOptions = getMockOclifConfig({ root: projectRoot });

const updateStub: UpdateFragment = {
  id: 'update-1234',
  group: 'group-source',
  branch: { id: 'branch-1234', name: 'main' },
  message: 'source message',
  runtimeVersion: 'exposdk:47.0.0',
  platform: 'ios',
  gitCommitHash: 'commit',
  isGitWorkingTreeDirty: false,
  manifestFragment: JSON.stringify({ fake: 'manifest' }),
  isRollBackToEmbedded: false,
  manifestPermalink: 'https://expo.dev/fake/manifest/link',
  codeSigningInfo: null,
  createdAt: '2022-01-01T12:00:00Z',
};

jest.mock('fs');
jest.mock('@expo/config');
jest.mock('../../../commandUtils/context/contextUtils/getProjectIdAsync');
jest.mock('../../../graphql/queries/AppQuery');
jest.mock('../../../graphql/queries/UpdateQuery');

describe(UpdateRollback.name, () => {
  beforeEach(() => {
    jest.spyOn(UpdateRepublish, 'run').mockResolvedValue(undefined as any);
    jest.spyOn(UpdateRollBackToEmbedded, 'run').mockResolvedValue(undefined as any);
  });

  afterEach(() => {
    vol.reset();
    jest.restoreAllMocks();
    jest.resetAllMocks();
  });

  it('errors in non-interactive mode when no group ID is provided', async () => {
    const flags = ['--non-interactive'];
    mockTestProject();

    await expect(new UpdateRollback(flags, commandOptions).run()).rejects.toThrow(
      'The update group ID argument is required in non-interactive mode.'
    );

    expect(UpdateRepublish.run).not.toHaveBeenCalled();
    expect(UpdateRollBackToEmbedded.run).not.toHaveBeenCalled();
  });

  it('republishes the previous update group when the source group is the latest', async () => {
    const flags = ['group-source', '--non-interactive'];
    mockTestProject();

    jest
      .mocked(UpdateQuery.viewUpdateGroupAsync)
      .mockResolvedValue([{ ...updateStub, group: 'group-source' }]);

    // Most-recent-first: the source group is the latest, the previous group follows.
    jest
      .mocked(UpdateQuery.viewUpdateGroupsPaginatedOnBranchAsync)
      .mockResolvedValue([
        [{ ...updateStub, group: 'group-source', message: 'source message' }],
        [{ ...updateStub, group: 'group-previous', message: 'previous message' }],
      ]);

    await new UpdateRollback(flags, commandOptions).run();

    expect(UpdateRollBackToEmbedded.run).not.toHaveBeenCalled();
    expect(UpdateRepublish.run).toHaveBeenCalledWith([
      '--group',
      'group-previous',
      '--message',
      'Roll back to "previous message" (group: group-previous)',
      '--non-interactive',
      '--platform',
      'all',
    ]);
  });

  it('rolls back to embedded when the source group is the only update for its runtime version', async () => {
    const flags = ['group-source', '--non-interactive'];
    mockTestProject();

    jest
      .mocked(UpdateQuery.viewUpdateGroupAsync)
      .mockResolvedValue([{ ...updateStub, group: 'group-source' }]);

    // Only the source group exists for this runtime version -> no previous group.
    jest
      .mocked(UpdateQuery.viewUpdateGroupsPaginatedOnBranchAsync)
      .mockResolvedValue([[{ ...updateStub, group: 'group-source', message: 'source message' }]]);

    await new UpdateRollback(flags, commandOptions).run();

    expect(UpdateRepublish.run).not.toHaveBeenCalled();
    expect(UpdateRollBackToEmbedded.run).toHaveBeenCalledWith([
      '--branch',
      'main',
      '--runtime-version',
      'exposdk:47.0.0',
      '--message',
      'Roll back to embedded',
      '--non-interactive',
      '--platform',
      'all',
    ]);
  });

  it('forwards --message, --platform, and --private-key-path to the republish path', async () => {
    const flags = [
      'group-source',
      '--non-interactive',
      '--message',
      'custom rollback message',
      '--platform',
      'ios',
      '--private-key-path',
      './keys/private-key.pem',
    ];
    mockTestProject();

    jest
      .mocked(UpdateQuery.viewUpdateGroupAsync)
      .mockResolvedValue([{ ...updateStub, group: 'group-source' }]);

    jest
      .mocked(UpdateQuery.viewUpdateGroupsPaginatedOnBranchAsync)
      .mockResolvedValue([
        [{ ...updateStub, group: 'group-source', message: 'source message' }],
        [{ ...updateStub, group: 'group-previous', message: 'previous message' }],
      ]);

    await new UpdateRollback(flags, commandOptions).run();

    expect(UpdateRepublish.run).toHaveBeenCalledWith([
      '--group',
      'group-previous',
      '--message',
      'custom rollback message',
      '--non-interactive',
      '--platform',
      'ios',
      '--private-key-path',
      './keys/private-key.pem',
    ]);
  });

  it('forwards --json to the republish path', async () => {
    const flags = ['group-source', '--json', '--non-interactive'];
    mockTestProject();

    jest
      .mocked(UpdateQuery.viewUpdateGroupAsync)
      .mockResolvedValue([{ ...updateStub, group: 'group-source' }]);

    jest
      .mocked(UpdateQuery.viewUpdateGroupsPaginatedOnBranchAsync)
      .mockResolvedValue([
        [{ ...updateStub, group: 'group-source', message: 'source message' }],
        [{ ...updateStub, group: 'group-previous', message: 'previous message' }],
      ]);

    await new UpdateRollback(flags, commandOptions).run();

    expect(UpdateRepublish.run).toHaveBeenCalledWith(expect.arrayContaining(['--json']));
  });

  it('forwards --platform and --private-key-path to the embedded rollback path', async () => {
    const flags = [
      'group-source',
      '--non-interactive',
      '--platform',
      'ios',
      '--private-key-path',
      './keys/private-key.pem',
    ];
    mockTestProject();

    jest
      .mocked(UpdateQuery.viewUpdateGroupAsync)
      .mockResolvedValue([{ ...updateStub, group: 'group-source' }]);

    // No previous group -> roll back to embedded.
    jest
      .mocked(UpdateQuery.viewUpdateGroupsPaginatedOnBranchAsync)
      .mockResolvedValue([[{ ...updateStub, group: 'group-source', message: 'source message' }]]);

    await new UpdateRollback(flags, commandOptions).run();

    expect(UpdateRepublish.run).not.toHaveBeenCalled();
    expect(UpdateRollBackToEmbedded.run).toHaveBeenCalledWith([
      '--branch',
      'main',
      '--runtime-version',
      'exposdk:47.0.0',
      '--message',
      'Roll back to embedded',
      '--non-interactive',
      '--platform',
      'ios',
      '--private-key-path',
      './keys/private-key.pem',
    ]);
  });

  it('errors when the source group is not the latest update for its runtime version', async () => {
    const flags = ['group-source', '--non-interactive'];
    mockTestProject();

    jest
      .mocked(UpdateQuery.viewUpdateGroupAsync)
      .mockResolvedValue([{ ...updateStub, group: 'group-source' }]);

    // A newer group is the latest for this runtime version, so the source group is stale.
    jest
      .mocked(UpdateQuery.viewUpdateGroupsPaginatedOnBranchAsync)
      .mockResolvedValue([
        [{ ...updateStub, group: 'group-newer', message: 'newer message' }],
        [{ ...updateStub, group: 'group-source', message: 'source message' }],
      ]);

    await expect(new UpdateRollback(flags, commandOptions).run()).rejects.toThrow(
      'Update group "group-source" is not the latest update on branch "main" for runtime version "exposdk:47.0.0" (the latest is "group-newer"). Only the latest update can be rolled back.'
    );

    expect(UpdateRepublish.run).not.toHaveBeenCalled();
    expect(UpdateRollBackToEmbedded.run).not.toHaveBeenCalled();
  });
});

function mockTestProject({
  configuredProjectId = '1234',
  extraManifest,
  extraVol,
}: {
  configuredProjectId?: string;
  extraManifest?: Partial<ExpoConfig>;
  extraVol?: DirectoryJSON;
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
      ...extraManifest,
    },
  };

  vol.fromJSON(
    {
      'package.json': JSON.stringify(packageJSON),
      'app.json': JSON.stringify(appJSON),
      ...extraVol,
    },
    projectRoot
  );

  const mockManifest = { exp: appJSON.expo };
  const graphqlClient = instance(mock<ExpoGraphqlClient>({}));

  jest.mocked(getConfig).mockReturnValue(mockManifest as any);
  jest.spyOn(PrivateProjectConfigContextField.prototype, 'getValueAsync').mockResolvedValue({
    exp: mockManifest.exp,
    projectDir: projectRoot,
    projectId: configuredProjectId,
  });

  jest.spyOn(LoggedInContextField.prototype, 'getValueAsync').mockResolvedValue({
    actor: jester,
    featureGating: new FeatureGating({}, new FeatureGateEnvOverrides()),
    graphqlClient,
    authenticationInfo: { accessToken: null, sessionSecret: '1234' },
  });

  jest.mocked(AppQuery.byIdAsync).mockResolvedValue({
    id: '1234',
    slug: 'testing-123',
    name: 'testing-123',
    fullName: '@jester/testing-123',
    ownerAccount: jester.accounts[0],
  });
}
