import assert from 'assert';

import { SelectBranch } from '../../branch/actions/SelectBranch';
import { getStandardBranchId, hasStandardBranchMap } from '../../channel/branch-mapping';
import { getUpdateBranch } from '../../channel/utils';
import { updateChannelBranchMappingAsync } from '../../commands/channel/edit';
import { EASUpdateAction, EASUpdateContext } from '../../eas-update/utils';
import {
  UpdateBranchBasicInfoFragment,
  UpdateChannelBasicInfoFragment,
  UpdateFragment,
} from '../../graphql/generated';
import { BranchQuery } from '../../graphql/queries/BranchQuery';
import {
  ChannelQuery,
  UpdateChannelObject,
  composeUpdateBranchObject,
} from '../../graphql/queries/ChannelQuery';
import { UpdateQuery } from '../../graphql/queries/UpdateQuery';
import Log from '../../log';
import { confirmAsync } from '../../prompts';
import {
  composeRollout,
  createRolloutBranchMapping,
  getRolloutInfoFromBranchMapping,
  isRollout,
} from '../branch-mapping';
import {
  displayRolloutDetails,
  formatBranchWithUpdateGroup,
  promptForRolloutPercentAsync,
} from '../utils';
import { SelectRuntime } from './SelectRuntime';

export type NonInteractiveOptions = {
  branchNameToRollout: string;
  percent: number;
  runtimeVersion: string;
};
function isNonInteractiveOptions(
  options: Partial<NonInteractiveOptions>
): options is NonInteractiveOptions {
  return !!options.branchNameToRollout && !!options.percent && !!options.runtimeVersion;
}
function assertNonInteractiveOptions(
  options: Partial<NonInteractiveOptions>
): asserts options is NonInteractiveOptions {
  assert(
    isNonInteractiveOptions(options),
    '--branch, --percent and --runtime-version are required for creating a rollout in non-interactive mode.'
  );
}

/**
 * Create a rollout for the project.
 */
export class CreateRollout implements EASUpdateAction<UpdateChannelBasicInfoFragment> {
  constructor(
    private channelInfo: UpdateChannelBasicInfoFragment,
    private options: Partial<NonInteractiveOptions> = {}
  ) {}

  public async runAsync(ctx: EASUpdateContext): Promise<UpdateChannelBasicInfoFragment> {
    const { branchNameToRollout } = this.options;
    const { nonInteractive, graphqlClient } = ctx;
    if (nonInteractive) {
      assertNonInteractiveOptions(this.options);
    }
    if (isRollout(this.channelInfo)) {
      throw new Error(`A rollout is already in progress for channel ${this.channelInfo.name}`);
    }
    if (!hasStandardBranchMap(this.channelInfo)) {
      throw new Error(
        `You have a custom branch mapping. Map your channel to a single branch before creating a rollout. Received: ${this.channelInfo.branchMapping}`
      );
    }
    const defaultBranchId = getStandardBranchId(this.channelInfo);
    const branchInfoToRollout = branchNameToRollout
      ? await this.resolveBranchNameAsync(ctx, branchNameToRollout)
      : await this.selectBranchAsync(ctx, defaultBranchId);
    if (branchInfoToRollout.id === defaultBranchId) {
      throw new Error(
        `Channel ${this.channelInfo.name} is already mapped to branch ${branchInfoToRollout.name}.`
      );
    }

    const runtimeVersion =
      this.options.runtimeVersion ??
      (await this.selectRuntimeVersionAsync(ctx, branchInfoToRollout, defaultBranchId));
    Log.newLine();
    const promptMessage = `What percent of users should be routed to branch ${branchInfoToRollout.name}?`;
    const percent = this.options.percent ?? (await promptForRolloutPercentAsync({ promptMessage }));
    const rolloutBranchMapping = createRolloutBranchMapping({
      defaultBranchId,
      rolloutBranchId: branchInfoToRollout.id,
      percent,
      runtimeVersion,
    });

    const channelObject = await this.getChannelObjectAsync(ctx, runtimeVersion);
    const defaultBranch = getUpdateBranch(channelObject, defaultBranchId);
    const defaultUpdateGroup = defaultBranch.updateGroups[0];
    const rolloutInfo = getRolloutInfoFromBranchMapping(rolloutBranchMapping);
    const rolledOutBranchUpdateGroup = await this.getLatestUpdateGroupOnBranchAsync(
      ctx,
      branchInfoToRollout,
      runtimeVersion
    );
    const rolledOutBranch = composeUpdateBranchObject(
      branchInfoToRollout,
      rolledOutBranchUpdateGroup ? [rolledOutBranchUpdateGroup] : []
    );
    const rollout = composeRollout(rolloutInfo, defaultBranch, rolledOutBranch);
    displayRolloutDetails(this.channelInfo.name, rollout);
    Log.log(
      formatBranchWithUpdateGroup(defaultUpdateGroup, defaultBranch, 100 - rollout.percentRolledOut)
    );
    Log.addNewLineIfNone();
    Log.log(
      formatBranchWithUpdateGroup(
        rolledOutBranchUpdateGroup,
        rolledOutBranch,
        rollout.percentRolledOut
      )
    );
    Log.addNewLineIfNone();
    const didConfirm = await this.confirmCreationAsync(ctx);
    if (!didConfirm) {
      throw new Error('Aborting...');
    }

    const newChannelInfo = await updateChannelBranchMappingAsync(graphqlClient, {
      channelId: this.channelInfo.id,
      branchMapping: JSON.stringify(rolloutBranchMapping),
    });
    Log.succeed('✅ Successfully created rollout');
    return newChannelInfo;
  }

  async confirmCreationAsync(ctx: EASUpdateContext): Promise<boolean> {
    const { nonInteractive } = ctx;
    if (nonInteractive) {
      return true;
    }
    return await confirmAsync({
      message: `Create rollout?`,
    });
  }

  async getChannelObjectAsync(
    ctx: EASUpdateContext,
    runtimeVersion: string
  ): Promise<UpdateChannelObject> {
    const { graphqlClient, app } = ctx;
    const { projectId } = app;
    return await ChannelQuery.viewUpdateChannelAsync(graphqlClient, {
      appId: projectId,
      channelName: this.channelInfo.name,
      filter: { runtimeVersions: [runtimeVersion] },
    });
  }

  async getLatestUpdateGroupOnBranchAsync(
    ctx: EASUpdateContext,
    branchInfo: UpdateBranchBasicInfoFragment,
    runtimeVersion: string
  ): Promise<UpdateFragment[] | null> {
    const { graphqlClient, app } = ctx;
    const { projectId } = app;
    const updateGroups = await UpdateQuery.viewUpdateGroupsOnBranchAsync(graphqlClient, {
      appId: projectId,
      branchName: branchInfo.name,
      limit: 1,
      offset: 0,
      filter: {
        runtimeVersions: [runtimeVersion],
      },
    });
    assert(
      updateGroups.length < 2,
      `Expected at most one update group. Received: ${JSON.stringify(updateGroups)}`
    );
    return updateGroups[0] ?? null;
  }

  async selectRuntimeVersionAsync(
    ctx: EASUpdateContext,
    branchToRollout: UpdateBranchBasicInfoFragment,
    defaultBranchId: string
  ): Promise<string> {
    const { graphqlClient, app } = ctx;
    const { projectId } = app;
    // we just want the branch name, not the update group
    const channelObjectRtvAgnostic = await ChannelQuery.viewUpdateChannelAsync(graphqlClient, {
      appId: projectId,
      channelName: this.channelInfo.name,
    });
    const defaultBranchRtvAgnostic = getUpdateBranch(channelObjectRtvAgnostic, defaultBranchId);
    const selectRuntimeAction = new SelectRuntime(branchToRollout, {
      anotherBranchToIntersectRuntimesBy: defaultBranchRtvAgnostic,
    });
    return await selectRuntimeAction.runAsync(ctx);
  }

  async selectBranchAsync(
    ctx: EASUpdateContext,
    defaultBranchId: string
  ): Promise<UpdateBranchBasicInfoFragment> {
    const selectBranchAction = new SelectBranch({
      printedType: 'branch to rollout',
      // we don't want to show the default branch as an option
      filterPredicate: (branchInfo: UpdateBranchBasicInfoFragment) =>
        branchInfo.id !== defaultBranchId,
    });
    const branchInfo = await selectBranchAction.runAsync(ctx);
    if (!branchInfo) {
      throw new Error(`You dont have any branches. Create one with 'eas branch:create'`);
    }
    return branchInfo;
  }

  async resolveBranchNameAsync(
    ctx: EASUpdateContext,
    branchName: string
  ): Promise<UpdateBranchBasicInfoFragment> {
    const { graphqlClient, app } = ctx;
    return await BranchQuery.getBranchByNameAsync(graphqlClient, {
      appId: app.projectId,
      name: branchName,
    });
  }
}
