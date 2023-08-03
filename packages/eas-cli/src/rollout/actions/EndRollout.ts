import assert from 'assert';
import chalk from 'chalk';

import { getAlwaysTrueBranchMapping } from '../../channel/branch-mapping';
import { updateChannelBranchMappingAsync } from '../../commands/channel/edit';
import { EASUpdateAction, EASUpdateContext } from '../../eas-update/utils';
import { UpdateChannelBasicInfoFragment } from '../../graphql/generated';
import { ChannelQuery, UpdateChannelObject } from '../../graphql/queries/ChannelQuery';
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

export enum EndOutcome {
  REPUBLISH_AND_ROUTE_BACK = 'republish-and-route-back',
  ROUTE_BACK = 'route-back',
}

export type GeneralOptions = {
  privateKeyPath: string | null;
};

export type NonInteractiveOptions = {
  outcome: EndOutcome;
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
export class EndRollout implements EASUpdateAction<UpdateChannelBasicInfoFragment> {
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
    let outcome: EndOutcome;
    if (!rolledOutUpdateGroup) {
      Log.log(`⚠️  There is no Update Group being served on ${rolledOutBranch.name}.`);
      assert(
        this.options.outcome !== EndOutcome.REPUBLISH_AND_ROUTE_BACK,
        'The only valid outcome for this rollout is to route back to the default branch. '
      );
      outcome = EndOutcome.ROUTE_BACK;
    } else {
      outcome = this.options.outcome ?? (await this.selectOutcomeAsync(rollout));
    }
    const didConfirm = await this.confirmOutcomeAsync(ctx, outcome, rollout);
    if (!didConfirm) {
      if (!rolledOutUpdateGroup) {
        Log.log(
          `If you wish to stop serving updates to your users, you can edit your rollout to 100% on ${chalk.bold(
            rolledOutBranch.name
          )} instead`
        );
      }
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

  async selectOutcomeAsync(rollout: Rollout): Promise<EndOutcome> {
    const { rolledOutBranch, percentRolledOut, defaultBranch } = rollout;
    const rolledOutUpdateGroup = rolledOutBranch.updateGroups[0];
    const defaultUpdateGroup = defaultBranch.updateGroups[0];
    const outcomes = [
      {
        value: EndOutcome.REPUBLISH_AND_ROUTE_BACK,
        title: formatBranchWithUpdateGroup(rolledOutUpdateGroup, rolledOutBranch, percentRolledOut),
      },
      {
        value: EndOutcome.ROUTE_BACK,
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
      message: `Which Update Group would you like to serve?`,
      choices: outcomes,
    });
    Log.newLine();
    if (selectedOutcome === EndOutcome.REPUBLISH_AND_ROUTE_BACK) {
      Log.log(
        `🍽️  The Update Group you chose is served by branch ${chalk.bold(rolledOutBranch.name)}`
      );
    } else {
      Log.log(
        `🍽️  The Update Group you chose is served by branch ${chalk.bold(defaultBranch.name)}`
      );
    }
    return selectedOutcome;
  }

  async performOutcomeAsync(
    ctx: EASUpdateContext,
    rollout: Rollout,
    outcome: EndOutcome
  ): Promise<UpdateChannelBasicInfoFragment> {
    const { graphqlClient, app } = ctx;
    const { rolledOutBranch, defaultBranch } = rollout;
    const rolledOutUpdateGroup = rolledOutBranch.updateGroups[0];
    if (outcome === EndOutcome.REPUBLISH_AND_ROUTE_BACK) {
      const codeSigningInfo = await getCodeSigningInfoAsync(
        ctx.app.exp,
        this.options.privateKeyPath ?? undefined
      );

      const arbitraryUpdate = rolledOutUpdateGroup[0];
      const { message: oldUpdateMessage, group: oldGroupId } = arbitraryUpdate;
      const newUpdateMessage = `Republish "${oldUpdateMessage!}" - group: ${oldGroupId}`;
      await republishAsync({
        graphqlClient,
        app,
        updatesToPublish: rolledOutUpdateGroup.map(update => ({
          ...update,
          groupId: update.group,
          branchId: update.branch.id,
          branchName: update.branch.name,
        })),
        codeSigningInfo,
        targetBranch: { branchId: defaultBranch.id, branchName: defaultBranch.name },
        updateMessage: newUpdateMessage,
      });
    }
    const alwaysTrueDefaultBranchMapping = getAlwaysTrueBranchMapping(defaultBranch.id);
    const newChannelInfo = await updateChannelBranchMappingAsync(graphqlClient, {
      channelId: this.channelInfo.id,
      branchMapping: JSON.stringify(alwaysTrueDefaultBranchMapping),
    });
    Log.addNewLineIfNone();
    Log.log(`🚗 Routed all traffic back to branch ${chalk.bold(defaultBranch.name)}`);
    Log.log(`✅ Successfully ended rollout`);
    return newChannelInfo;
  }

  async confirmOutcomeAsync(
    ctx: EASUpdateContext,
    selectedOutcome: EndOutcome,
    rollout: Rollout
  ): Promise<boolean> {
    const { nonInteractive } = ctx;
    if (nonInteractive) {
      return true;
    }
    const { rolledOutBranch, defaultBranch } = rollout;
    Log.newLine();
    if (selectedOutcome === EndOutcome.REPUBLISH_AND_ROUTE_BACK) {
      Log.log(`Ending the rollout will do the following:`);
      const actions = formatFields([
        {
          label: '1.',
          value: `🔁 Republish the Update Group from ${chalk.bold(
            rolledOutBranch.name
          )} onto ${chalk.bold(defaultBranch.name)}`,
        },
        { label: '2.', value: `⬅️  Route all users back to ${chalk.bold(defaultBranch.name)}` },
      ]);
      Log.log(actions);
    } else {
      Log.log(
        `⬅️  Ending the rollout will route all users back to ${chalk.bold(defaultBranch.name)}`
      );
    }
    return await confirmAsync({
      message: `Continue?`,
    });
  }
}
