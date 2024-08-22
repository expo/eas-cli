import { AppJSONConfig, ExpoConfig, PackageJSONConfig, getConfig } from '@expo/config';
import { DirectoryJSON, vol } from 'memfs';
import { instance, mock } from 'ts-mockito';

import LoggedInContextField from '../../../commandUtils/context/LoggedInContextField';
import { PrivateProjectConfigContextField } from '../../../commandUtils/context/PrivateProjectConfigContextField';
import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import FeatureGateEnvOverrides from '../../../commandUtils/gating/FeatureGateEnvOverrides';
import FeatureGating from '../../../commandUtils/gating/FeatureGating';
import { jester } from '../../../credentials/__tests__/fixtures-constants';
import { UpdateFragment } from '../../../graphql/generated';
import { PublishMutation } from '../../../graphql/mutations/PublishMutation';
import { AppQuery } from '../../../graphql/queries/AppQuery';
import { UpdateQuery } from '../../../graphql/queries/UpdateQuery';
import { getBranchNameFromChannelNameAsync } from '../../../update/getBranchNameFromChannelNameAsync';
import { selectUpdateGroupOnBranchAsync } from '../../../update/queries';
import {
  getCodeSigningInfoAsync,
  getManifestBodyAsync,
  signBody,
} from '../../../utils/code-signing';
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
  isRollBackToEmbedded: false,
  manifestPermalink: 'https://expo.dev/fake/manifest/link',
  codeSigningInfo: null,
  createdAt: '2022-01-01T12:00:00Z',
};

jest.mock('fs');
jest.mock('@expo/config');
jest.mock('../../../commandUtils/context/contextUtils/getProjectIdAsync');
jest.mock('../../../graphql/mutations/PublishMutation');
jest.mock('../../../graphql/queries/AppQuery');
jest.mock('../../../graphql/queries/UpdateQuery');
jest.mock('../../../update/getBranchNameFromChannelNameAsync');
jest.mock('../../../update/queries');
jest.mock('../../../ora', () => ({
  ora: () => ({
    start: () => ({ succeed: () => {}, fail: () => {} }),
  }),
}));
jest.mock('../../../utils/code-signing');
jest.mock('../../../fetch');

describe(UpdateRepublish.name, () => {
  afterEach(() => {
    vol.reset();
  });

  it('errors when providing both --group and --branch', async () => {
    const flags = ['--group=1234', '--branch=main'];

    mockTestProject();

    await expect(new UpdateRepublish(flags, commandOptions).run()).rejects.toThrow(
      /--branch=main cannot also be provided when using --group/
    );
  });

  it('errors when providing both --channel and --branch', async () => {
    const flags = ['--channel=main', '--branch=main'];

    mockTestProject();

    await expect(new UpdateRepublish(flags, commandOptions).run()).rejects.toThrow(
      /--branch=main cannot also be provided when using --channel/
    );
  });

  it('errors when providing both --group and --channel', async () => {
    const flags = ['--group=1234', '--channel=main'];

    mockTestProject();

    await expect(new UpdateRepublish(flags, commandOptions).run()).rejects.toThrow(
      /--channel=main cannot also be provided when using --group/
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

  it('re-creates update with --group and --message', async () => {
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

  it('re-creates update using codesigning with --group and --message', async () => {
    const flags = [
      '--group=1234',
      '--message=test-republish',
      `--private-key-path=./keys/test-private-key.pem`,
    ];
    const codeSigning = {
      alg: 'rsa-v1_5-sha256',
      keyid: 'keyid',
      sig: 'sig',
    };

    mockTestProject({
      extraManifest: {
        updates: {
          codeSigningCertificate: './keys/test-certificate.pem',
          codeSigningMetadata: {
            alg: 'rsa-v1_5-sha256',
            keyid: 'keyid',
          },
        },
      },
      extraVol: {
        './keys/test-private-key.pem': 'testpemprivate',
        './keys/test-certificate.pem': 'testpemcertificate',
      },
    });

    jest.mocked(getCodeSigningInfoAsync).mockResolvedValue({
      privateKey: '' as any,
      certificate: '' as any,
      codeSigningMetadata: { alg: 'rsa-v1_5-sha256', keyid: 'keyid' },
    });
    jest.mocked(getManifestBodyAsync).mockResolvedValue('test');
    jest.mocked(signBody).mockReturnValue('sig');

    // Mock queries to retrieve the update and code signing info
    jest
      .mocked(UpdateQuery.viewUpdateGroupAsync)
      .mockResolvedValue([{ ...updateStub, codeSigningInfo: codeSigning }]);
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

  it('re-creates update with --branch and --message', async () => {
    const flags = ['--branch=branch123', '--message=test-republish'];

    mockTestProject();
    // Mock the prompt to ask the user which update to republish, from branch
    jest.mocked(selectUpdateGroupOnBranchAsync).mockResolvedValue([updateStub]);
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

    expect(selectUpdateGroupOnBranchAsync).toHaveBeenCalledWith(
      expect.any(Object), // graphql client
      expect.objectContaining({ branchName: 'branch123' })
    );

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
  });

  it('re-creates update with --channel and --message', async () => {
    const flags = ['--channel=channel123', '--message=test-republish'];

    mockTestProject();
    // Mock resolving the channel to branch name, only valid for a single branch connected
    jest.mocked(getBranchNameFromChannelNameAsync).mockResolvedValue('branchFromChannel');
    // Mock the prompt to ask the user which update to republish, from branch
    jest.mocked(selectUpdateGroupOnBranchAsync).mockResolvedValue([updateStub]);
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

    expect(selectUpdateGroupOnBranchAsync).toHaveBeenCalledWith(
      expect.any(Object), // graphql client
      expect.objectContaining({ branchName: 'branchFromChannel' })
    );

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
  });
});

/** Create a new in-memory project, based on src/commands/project/__tests__/init.test.ts */
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
  });

  jest.mocked(AppQuery.byIdAsync).mockResolvedValue({
    id: '1234',
    slug: 'testing-123',
    name: 'testing-123',
    fullName: '@jester/testing-123',
    ownerAccount: jester.accounts[0],
  });
}
