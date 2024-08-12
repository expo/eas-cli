import assert from 'assert';
import chalk from 'chalk';

import { getAlwaysTrueBranchMapping } from '../../channel/branch-mapping';
import { updateChannelBranchMappingAsync } from '../../commands/channel/edit';
import { EASUpdateAction, EASUpdateContext } from '../../eas-update/utils';
import { UpdateChannelBasicInfoFragment } from '../../graphql/generated';
import {
  ChannelQuery,
  UpdateBranchObject,
  UpdateChannelObject,
} from '../../graphql/queries/ChannelQuery';
import Log from '../../log';
import { confirmAsync, promptAsync } from '../../prompts';
import { republishAsync } from '../../update/republish';
import { getCodeSigningInfoAsync } from '../../utils/code-signing';
import formatFields from '../../utils/formatFields';
import {
  Rollout,
  getRollout,
  getRolloutInfo,
  isConstrainedRolloutInfo,
  isRollout,
} from '../branch-mapping';
import { formatBranchWithUpdateGroup } from '../utils';

export enum NewEndOutcome {
  ROLL_OUT_AND_REPUBLISH = 'roll-out-and-republish',
  REVERT_AND_REPUBLISH = 'revert-and-republish',
}

export type GeneralOptions = {
  privateKeyPath: string | null;
};

export type NonInteractiveOptions = {
  outcome: NewEndOutcome;
};
function isNonInteractiveOptions(
  options: Partial<NonInteractiveOptions>
): options is NonInteractiveOptions {
  return !!options.outcome;
}
function assertNonInteractiveOptions(
  options: Partial<NonInteractiveOptions>
): asserts options is NonInteractiveOptions {
  assert(
    isNonInteractiveOptions(options),
    '--outcome is required for ending a rollout in non-interactive mode.'
  );
}

/**
 * End an existing rollout for the project.
 */
export class EndRolloutNew implements EASUpdateAction<UpdateChannelBasicInfoFragment> {
  constructor(
    private channelInfo: UpdateChannelBasicInfoFragment,
    private options: Partial<NonInteractiveOptions> & GeneralOptions
  ) {}

  public async runAsync(ctx: EASUpdateContext): Promise<UpdateChannelBasicInfoFragment> {
    const { nonInteractive } = ctx;
    if (nonInteractive) {
      assertNonInteractiveOptions(this.options);
    }

    const channelObject = await this.getChannelObjectAsync(ctx);
    const rollout = getRollout(channelObject);
    const { rolledOutBranch } = rollout;
    const rolledOutUpdateGroup = rolledOutBranch.updateGroups[0];
    let outcome: NewEndOutcome;
    if (!rolledOutUpdateGroup) {
      Log.log(`⚠️  There is no update group being served on the ${rolledOutBranch.name} branch.`);
      assert(
        this.options.outcome !== NewEndOutcome.REVERT_AND_REPUBLISH,
        `The only valid outcome for this rollout is to revert users back to the ${rollout.defaultBranch.name} branch. `
      );
      outcome = NewEndOutcome.REVERT_AND_REPUBLISH;
    } else {
      outcome = this.options.outcome ?? (await this.selectOutcomeAsync(rollout));
    }
    const didConfirm = await this.confirmOutcomeAsync(ctx, outcome, rollout);
    if (!didConfirm) {
      throw new Error('Aborting...');
    }
    return await this.performOutcomeAsync(ctx, rollout, outcome);
  }

  async getChannelObjectAsync(ctx: EASUpdateContext): Promise<UpdateChannelObject> {
    const { graphqlClient, app } = ctx;
    const { projectId } = app;
    if (!isRollout(this.channelInfo)) {
      throw new Error(
        `The channel ${chalk.bold(
          this.channelInfo.name
        )} is not a rollout. To end a rollout, you must specify a channel with an ongoing rollout.`
      );
    }
    const rolloutInfo = getRolloutInfo(this.channelInfo);
    return await ChannelQuery.viewUpdateChannelAsync(graphqlClient, {
      appId: projectId,
      channelName: this.channelInfo.name,
      ...(isConstrainedRolloutInfo(rolloutInfo)
        ? { filter: { runtimeVersions: [rolloutInfo.runtimeVersion] } }
        : {}),
    });
  }

  async selectOutcomeAsync(rollout: Rollout<UpdateBranchObject>): Promise<NewEndOutcome> {
    const { rolledOutBranch, percentRolledOut, defaultBranch } = rollout;
    const rolledOutUpdateGroup = rolledOutBranch.updateGroups[0];
    const defaultUpdateGroup = defaultBranch.updateGroups[0];
    const outcomes = [
      {
        value: NewEndOutcome.ROLL_OUT_AND_REPUBLISH,
        title: formatBranchWithUpdateGroup(rolledOutUpdateGroup, rolledOutBranch, percentRolledOut),
      },
      {
        value: NewEndOutcome.REVERT_AND_REPUBLISH,
        title: formatBranchWithUpdateGroup(
          defaultUpdateGroup,
          defaultBranch,
          100 - percentRolledOut
        ),
      },
    ];
    const { outcome: selectedOutcome } = await promptAsync({
      type: 'select',
      name: 'outcome',
      message: `Which update group would you like to serve?`,
      choices: outcomes,
    });
    Log.newLine();
    if (selectedOutcome === NewEndOutcome.ROLL_OUT_AND_REPUBLISH) {
      Log.log(
        `➡️ 📱 The update group you chose is served by branch ${chalk.bold(rolledOutBranch.name)}`
      );
    } else {
      Log.log(
        `➡️ 📱 The update group you chose is served by branch ${chalk.bold(defaultBranch.name)}`
      );
    }
    return selectedOutcome;
  }

  async performOutcomeAsync(
    ctx: EASUpdateContext,
    rollout: Rollout<UpdateBranchObject>,
    outcome: NewEndOutcome
  ): Promise<UpdateChannelBasicInfoFragment> {
    const { graphqlClient, app } = ctx;
    const { rolledOutBranch, defaultBranch } = rollout;

    const branchToRepublishLatestAndPointChannelTo =
      outcome === NewEndOutcome.ROLL_OUT_AND_REPUBLISH ? rolledOutBranch : defaultBranch;

    const updateGroup = branchToRepublishLatestAndPointChannelTo.updateGroups[0];

    const codeSigningInfo = await getCodeSigningInfoAsync(
      ctx.app.exp,
      this.options.privateKeyPath ?? undefined
    );
    const arbitraryUpdate = updateGroup[0];
    const { message: oldUpdateMessage, group: oldGroupId } = arbitraryUpdate;
    const newUpdateMessage = `Republish "${oldUpdateMessage!}" - group: ${oldGroupId}`;

    await republishAsync({
      graphqlClient,
      app,
      updatesToPublish: updateGroup.map(update => ({
        ...update,
        groupId: update.group,
        branchId: update.branch.id,
        branchName: update.branch.name,
      })),
      codeSigningInfo,
      targetBranch: {
        branchId: branchToRepublishLatestAndPointChannelTo.id,
        branchName: branchToRepublishLatestAndPointChannelTo.name,
      },
      updateMessage: newUpdateMessage,
    });

    updated;

    const alwaysTrueDefaultBranchMapping = getAlwaysTrueBranchMapping(
      branchToRepublishLatestAndPointChannelTo.id
    );
    const newChannelInfo = await updateChannelBranchMappingAsync(graphqlClient, {
      channelId: this.channelInfo.id,
      branchMapping: JSON.stringify(alwaysTrueDefaultBranchMapping),
    });
    Log.addNewLineIfNone();
    Log.log(`✅ Successfully ended rollout`);
    return newChannelInfo;
  }

  async confirmOutcomeAsync(
    ctx: EASUpdateContext,
    selectedOutcome: NewEndOutcome,
    rollout: Rollout<UpdateBranchObject>
  ): Promise<boolean> {
    const { nonInteractive } = ctx;
    if (nonInteractive) {
      return true;
    }
    const { rolledOutBranch, defaultBranch } = rollout;
    const branchToRepublishLatestAndPointChannelTo =
      selectedOutcome === NewEndOutcome.ROLL_OUT_AND_REPUBLISH ? rolledOutBranch : defaultBranch;
    Log.newLine();
    Log.log(`Ending the rollout will do the following:`);
    const actions = formatFields([
      {
        label: '1.',
        value: `🔁 Republish the latest update group from ${chalk.bold(
          branchToRepublishLatestAndPointChannelTo.name
        )} onto ${chalk.bold(
          branchToRepublishLatestAndPointChannelTo.name
        )} (the same branch) to ensure all users get the latest update`,
      },
      {
        label: '2.',
        value: `⬅️  Point all users to ${chalk.bold(
          branchToRepublishLatestAndPointChannelTo.name
        )}`,
      },
    ]);
    Log.log(actions);
    return await confirmAsync({
      message: `Continue?`,
    });
  }
}
