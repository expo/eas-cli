import chalk from 'chalk';

import { resolveUpdateGroupsSupersedingActiveRolloutsAsync } from '../active-rollout';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { AppPlatform, PublishUpdateGroupInput, UpdateFragment } from '../../graphql/generated';
import { UpdateQuery } from '../../graphql/queries/UpdateQuery';
import Log from '../../log';

jest.mock('../../graphql/queries/UpdateQuery');
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

beforeEach(() => {
  jest.mocked(UpdateQuery.viewUpdateGroupsOnBranchByIdAsync).mockReset();
  jest.mocked(Log.warn).mockReset();
});

describe(resolveUpdateGroupsSupersedingActiveRolloutsAsync, () => {
  it('leaves update groups untouched when no rollout is in progress', async () => {
    jest
      .mocked(UpdateQuery.viewUpdateGroupsOnBranchByIdAsync)
      .mockResolvedValue([[{ ...rolloutUpdateStub, rolloutPercentage: null }]]);

    const result = await resolveUpdateGroupsSupersedingActiveRolloutsAsync(
      graphqlClient,
      [updateGroupStub],
      { forceEndActiveRollout: false }
    );

    expect(result).toEqual([updateGroupStub]);
  });

  it('names the rollout to supersede when the flag is passed', async () => {
    jest
      .mocked(UpdateQuery.viewUpdateGroupsOnBranchByIdAsync)
      .mockResolvedValue([[rolloutUpdateStub]]);

    const result = await resolveUpdateGroupsSupersedingActiveRolloutsAsync(
      graphqlClient,
      [updateGroupStub],
      { forceEndActiveRollout: true }
    );

    expect(UpdateQuery.viewUpdateGroupsOnBranchByIdAsync).toHaveBeenCalledWith(graphqlClient, {
      branchId: 'branch-1234',
      limit: 1,
      offset: 0,
      filter: { runtimeVersions: ['1.0.0'], platform: AppPlatform.Ios },
    });
    expect(UpdateQuery.viewUpdateGroupsOnBranchAsync).not.toHaveBeenCalled();
    expect(result[0].previousRolloutUpdateToClobberIdGroup).toEqual({ ios: 'update-rollout' });
  });

  it('names the rollout for each platform that has one', async () => {
    jest
      .mocked(UpdateQuery.viewUpdateGroupsOnBranchByIdAsync)
      .mockImplementation(async (_client, { filter }) =>
        filter?.platform === AppPlatform.Ios
          ? [[rolloutUpdateStub]]
          : [[{ ...rolloutUpdateStub, id: 'update-android', platform: 'android' }]]
      );

    const result = await resolveUpdateGroupsSupersedingActiveRolloutsAsync(
      graphqlClient,
      [{ ...updateGroupStub, rollBackToEmbeddedInfoGroup: { ios: true, android: true } }],
      { forceEndActiveRollout: true }
    );

    expect(result[0].previousRolloutUpdateToClobberIdGroup).toEqual({
      ios: 'update-rollout',
      android: 'update-android',
    });
  });

  it('names the rollout only for the update group that has one', async () => {
    jest
      .mocked(UpdateQuery.viewUpdateGroupsOnBranchByIdAsync)
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
      { forceEndActiveRollout: true }
    );

    expect(result[0].previousRolloutUpdateToClobberIdGroup).toBeUndefined();
    expect(result[1].previousRolloutUpdateToClobberIdGroup).toEqual({ ios: 'update-rollout' });
  });

  it('rejects rolling out a new update over a rollout in progress', async () => {
    jest
      .mocked(UpdateQuery.viewUpdateGroupsOnBranchByIdAsync)
      .mockResolvedValue([[rolloutUpdateStub]]);

    await expect(
      resolveUpdateGroupsSupersedingActiveRolloutsAsync(graphqlClient, [updateGroupStub], {
        forceEndActiveRollout: true,
        rolloutPercentage: 10,
      })
    ).rejects.toThrow('Cannot start a rollout while another rollout is in progress');
  });

  it('lists each platform on its own line, ordered and aligned', async () => {
    jest
      .mocked(UpdateQuery.viewUpdateGroupsOnBranchByIdAsync)
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
      { forceEndActiveRollout: true }
    );

    const warnings = jest.mocked(Log.warn).mock.calls.flat();
    expect(warnings[0]).toBe('A rollout is in progress for runtime version 1.0.0:');
    expect(String(warnings[1]).split('\n')).toEqual([
      chalk.bold('Platform  Rollout  Message          Update group  Control update'),
      '--------  -------  ---------------  ------------  --------------',
      'Android   5%       rollout message  group-ro      group-co      ',
      'iOS       25%      rollout message  group-ro      group-co      ',
    ]);
  });

  it('ignores platforms that cannot carry an update', async () => {
    jest
      .mocked(UpdateQuery.viewUpdateGroupsOnBranchByIdAsync)
      .mockResolvedValue([[rolloutUpdateStub]]);

    const result = await resolveUpdateGroupsSupersedingActiveRolloutsAsync(
      graphqlClient,
      [{ ...updateGroupStub, rollBackToEmbeddedInfoGroup: { ios: true, web: true } }],
      { forceEndActiveRollout: true }
    );

    expect(UpdateQuery.viewUpdateGroupsOnBranchByIdAsync).toHaveBeenCalledTimes(1);
    expect(result[0].previousRolloutUpdateToClobberIdGroup).toEqual({ ios: 'update-rollout' });
  });

  it('leaves an update group with no platforms untouched', async () => {
    const emptyGroup = { branchId: 'branch-1234', runtimeVersion: '1.0.0' };

    const result = await resolveUpdateGroupsSupersedingActiveRolloutsAsync(
      graphqlClient,
      [emptyGroup],
      { forceEndActiveRollout: true }
    );

    expect(UpdateQuery.viewUpdateGroupsOnBranchByIdAsync).not.toHaveBeenCalled();
    expect(result).toEqual([emptyGroup]);
  });

  it('leaves the message and control cells empty when the rollout has neither', async () => {
    jest
      .mocked(UpdateQuery.viewUpdateGroupsOnBranchByIdAsync)
      .mockResolvedValue([[{ ...rolloutUpdateStub, message: null, rolloutControlUpdate: null }]]);

    await resolveUpdateGroupsSupersedingActiveRolloutsAsync(graphqlClient, [updateGroupStub], {
      forceEndActiveRollout: true,
    });

    expect(String(jest.mocked(Log.warn).mock.calls.flat()[1]).split('\n')).toEqual([
      chalk.bold('Platform  Rollout  Message  Update group  Control update'),
      '--------  -------  -------  ------------  --------------',
      'iOS       25%               group-ro                    ',
    ]);
  });

  it('requires the flag to supersede a rollout in progress', async () => {
    jest
      .mocked(UpdateQuery.viewUpdateGroupsOnBranchByIdAsync)
      .mockResolvedValue([[rolloutUpdateStub]]);

    await expect(
      resolveUpdateGroupsSupersedingActiveRolloutsAsync(graphqlClient, [updateGroupStub], {
        forceEndActiveRollout: false,
      })
    ).rejects.toThrow('Re-run with --force-end-active-rollout to end the rollout and publish.');
  });
});
