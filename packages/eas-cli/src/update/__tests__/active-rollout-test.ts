import { resolveUpdateGroupsSupersedingActiveRolloutsAsync } from '../active-rollout';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { AppPlatform, PublishUpdateGroupInput, UpdateFragment } from '../../graphql/generated';
import { UpdateQuery } from '../../graphql/queries/UpdateQuery';
import Log from '../../log';
import { confirmAsync } from '../../prompts';

jest.mock('../../graphql/queries/UpdateQuery');
jest.mock('../../prompts');
jest.mock('../../log');

const graphqlClient = {} as ExpoGraphqlClient;

const rolloutUpdateStub: UpdateFragment = {
  id: 'update-rollout',
  group: 'group-rollout',
  branch: { id: 'branch-1234', name: 'main' },
  message: 'rollout message',
  runtime: { id: 'runtime-1234', version: '1.0.0' },
  platform: 'ios',
  gitCommitHash: 'commit',
  isGitWorkingTreeDirty: false,
  manifestFragment: JSON.stringify({ fake: 'manifest' }),
  isRollBackToEmbedded: false,
  manifestPermalink: 'https://expo.dev/fake/manifest/link',
  codeSigningInfo: null,
  createdAt: '2022-01-01T12:00:00Z',
  rolloutPercentage: 25,
  rolloutControlUpdate: { id: 'update-control', group: 'group-control-1234' },
};

const manifestStub = {
  assets: [],
  launchAsset: {
    bundleKey: 'bundle',
    contentType: 'application/javascript',
    fileSHA256: 'sha',
    storageKey: 'storage',
  },
};

const updateGroupStub: PublishUpdateGroupInput = {
  branchId: 'branch-1234',
  runtimeVersion: '1.0.0',
  rollBackToEmbeddedInfoGroup: { ios: true },
};

const resolveOptions = { appId: 'app-1234', branchName: 'main' };

beforeEach(() => {
  jest.mocked(UpdateQuery.viewUpdateGroupsOnBranchAsync).mockReset();
  jest.mocked(confirmAsync).mockReset();
  jest.mocked(Log.warn).mockReset();
});

describe(resolveUpdateGroupsSupersedingActiveRolloutsAsync, () => {
  it('leaves update groups untouched when no rollout is in progress', async () => {
    jest
      .mocked(UpdateQuery.viewUpdateGroupsOnBranchAsync)
      .mockResolvedValue([[{ ...rolloutUpdateStub, rolloutPercentage: null }]]);

    const result = await resolveUpdateGroupsSupersedingActiveRolloutsAsync(
      graphqlClient,
      [updateGroupStub],
      { ...resolveOptions, nonInteractive: false, forceEndActiveRollout: false }
    );

    expect(result).toEqual([updateGroupStub]);
    expect(confirmAsync).not.toHaveBeenCalled();
  });

  it('names the rollout to supersede without prompting when the flag is passed', async () => {
    jest.mocked(UpdateQuery.viewUpdateGroupsOnBranchAsync).mockResolvedValue([[rolloutUpdateStub]]);

    const result = await resolveUpdateGroupsSupersedingActiveRolloutsAsync(
      graphqlClient,
      [updateGroupStub],
      { ...resolveOptions, nonInteractive: false, forceEndActiveRollout: true }
    );

    expect(result[0].previousRolloutUpdateToClobberIdGroup).toEqual({ ios: 'update-rollout' });
    expect(confirmAsync).not.toHaveBeenCalled();
  });

  it('names the rollout to supersede once the prompt is confirmed', async () => {
    jest.mocked(UpdateQuery.viewUpdateGroupsOnBranchAsync).mockResolvedValue([[rolloutUpdateStub]]);
    jest.mocked(confirmAsync).mockResolvedValue(true);

    const result = await resolveUpdateGroupsSupersedingActiveRolloutsAsync(
      graphqlClient,
      [updateGroupStub],
      { ...resolveOptions, nonInteractive: false, forceEndActiveRollout: false }
    );

    expect(result[0].previousRolloutUpdateToClobberIdGroup).toEqual({ ios: 'update-rollout' });
  });

  it('aborts when the prompt is declined', async () => {
    jest.mocked(UpdateQuery.viewUpdateGroupsOnBranchAsync).mockResolvedValue([[rolloutUpdateStub]]);
    jest.mocked(confirmAsync).mockResolvedValue(false);

    await expect(
      resolveUpdateGroupsSupersedingActiveRolloutsAsync(graphqlClient, [updateGroupStub], {
        ...resolveOptions,
        nonInteractive: false,
        forceEndActiveRollout: false,
      })
    ).rejects.toThrow('Aborted.');
  });

  it('names the rollout for each platform that has one', async () => {
    jest
      .mocked(UpdateQuery.viewUpdateGroupsOnBranchAsync)
      .mockImplementation(async (_client, { filter }) =>
        filter?.platform === AppPlatform.Ios
          ? [[rolloutUpdateStub]]
          : [[{ ...rolloutUpdateStub, id: 'update-android', platform: 'android' }]]
      );

    const result = await resolveUpdateGroupsSupersedingActiveRolloutsAsync(
      graphqlClient,
      [{ ...updateGroupStub, rollBackToEmbeddedInfoGroup: { ios: true, android: true } }],
      { ...resolveOptions, nonInteractive: false, forceEndActiveRollout: true }
    );

    expect(result[0].previousRolloutUpdateToClobberIdGroup).toEqual({
      ios: 'update-rollout',
      android: 'update-android',
    });
  });

  it('names the rollout only for the update group that has one', async () => {
    jest
      .mocked(UpdateQuery.viewUpdateGroupsOnBranchAsync)
      .mockImplementation(async (_client, { filter }) =>
        filter?.runtimeVersions?.includes('1.0.0')
          ? [[rolloutUpdateStub]]
          : [[{ ...rolloutUpdateStub, rolloutPercentage: null }]]
      );

    const result = await resolveUpdateGroupsSupersedingActiveRolloutsAsync(
      graphqlClient,
      [
        { ...updateGroupStub, runtimeVersion: '2.0.0' },
        { ...updateGroupStub, updateInfoGroup: { ios: manifestStub } },
      ],
      { ...resolveOptions, nonInteractive: false, forceEndActiveRollout: true }
    );

    expect(result[0].previousRolloutUpdateToClobberIdGroup).toBeUndefined();
    expect(result[1].previousRolloutUpdateToClobberIdGroup).toEqual({ ios: 'update-rollout' });
  });

  it('supersedes an in-progress rollout when the new update is itself a rollout', async () => {
    jest.mocked(UpdateQuery.viewUpdateGroupsOnBranchAsync).mockResolvedValue([[rolloutUpdateStub]]);

    const result = await resolveUpdateGroupsSupersedingActiveRolloutsAsync(
      graphqlClient,
      [updateGroupStub],
      {
        ...resolveOptions,
        nonInteractive: false,
        forceEndActiveRollout: true,
        rolloutPercentage: 10,
      }
    );

    expect(result[0].previousRolloutUpdateToClobberIdGroup).toEqual({ ios: 'update-rollout' });
    expect(confirmAsync).not.toHaveBeenCalled();
  });

  it('states the resulting split when the new update is itself a rollout', async () => {
    jest.mocked(UpdateQuery.viewUpdateGroupsOnBranchAsync).mockResolvedValue([[rolloutUpdateStub]]);
    jest.mocked(confirmAsync).mockResolvedValue(true);

    await resolveUpdateGroupsSupersedingActiveRolloutsAsync(graphqlClient, [updateGroupStub], {
      ...resolveOptions,
      nonInteractive: false,
      forceEndActiveRollout: false,
      rolloutPercentage: 10,
    });

    expect(jest.mocked(Log.warn).mock.calls.flat()).toContain(
      'Ending the rollout makes your new update the latest for 10% of users. The other 90% receive the update that was rolling out.'
    );
  });

  it('lists each platform on its own line, ordered and aligned', async () => {
    jest
      .mocked(UpdateQuery.viewUpdateGroupsOnBranchAsync)
      .mockImplementation(async (_client, { filter }) =>
        filter?.platform === AppPlatform.Ios
          ? [[rolloutUpdateStub]]
          : [
              [
                {
                  ...rolloutUpdateStub,
                  id: 'update-android',
                  platform: 'android',
                  rolloutPercentage: 5,
                },
              ],
            ]
      );

    await resolveUpdateGroupsSupersedingActiveRolloutsAsync(
      graphqlClient,
      [{ ...updateGroupStub, rollBackToEmbeddedInfoGroup: { ios: true, android: true } }],
      { ...resolveOptions, nonInteractive: false, forceEndActiveRollout: true }
    );

    const warnings = jest.mocked(Log.warn).mock.calls.flat();
    expect(warnings[0]).toBe('A rollout is in progress for runtime version 1.0.0:');
    expect(warnings.slice(1, 3)).toEqual([
      '  • Android  5%   "rollout message"  group group-ro  control group-co',
      '  • iOS      25%  "rollout message"  group group-ro  control group-co',
    ]);
  });

  it('requires the flag in non-interactive mode', async () => {
    jest.mocked(UpdateQuery.viewUpdateGroupsOnBranchAsync).mockResolvedValue([[rolloutUpdateStub]]);

    await expect(
      resolveUpdateGroupsSupersedingActiveRolloutsAsync(graphqlClient, [updateGroupStub], {
        ...resolveOptions,
        nonInteractive: true,
        forceEndActiveRollout: false,
      })
    ).rejects.toThrow('--force-end-active-rollout');
    expect(confirmAsync).not.toHaveBeenCalled();
  });
});
