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
  ConstrainedRolloutInfo,
  LegacyRolloutInfo,
  Rollout,
  getConstrainedRolloutForRtv,
  getLegacyRollout,
  getRolloutInfo,
  isConstrainedRolloutInfo,
  isLegacyRolloutInfo,
} from '../branch-mapping';
import { formatBranchWithUpdateGroup } from '../utils';

export enum EndOutcome {
  REPUBLISH_AND_REVERT = 'republish-and-revert',
  REVERT = 'revert',
}

export type GeneralOptions = {
  privateKeyPath: string | null;
};

export type NonInteractiveOptions = {
  outcome: EndOutcome;
  runtimeVersion?: string;
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
function isConstrainedNonInteractiveOptions(
  options: Partial<NonInteractiveOptions>
): options is Required<NonInteractiveOptions> {
  return !!options.outcome && !!options.runtimeVersion;
}
function assertConstrainedRolloutNonInteractiveOptions(
  options: Partial<NonInteractiveOptions>
): asserts options is Required<NonInteractiveOptions> {
  assert(
    isConstrainedNonInteractiveOptions(options),
    '--outcome and --runtime-version are required for ending a rollout in non-interactive mode.'
  );
}

/**
 * End an existing rollout for the channel and runtime version.
 */
export class EndRollout implements EASUpdateAction<UpdateChannelBasicInfoFragment> {
  constructor(
    private channelInfo: UpdateChannelBasicInfoFragment,
    private options: Partial<NonInteractiveOptions> & GeneralOptions
  ) {}

  private async runForLegacyRolloutAsync(
    ctx: EASUpdateContext
  ): Promise<UpdateChannelBasicInfoFragment> {
    const { graphqlClient, app } = ctx;
    const { projectId } = app;

    const channelObject = await ChannelQuery.viewUpdateChannelAsync(graphqlClient, {
      appId: projectId,
      channelName: this.channelInfo.name,
    });
    const rollout = getLegacyRollout(channelObject);
    const { rolledOutBranch } = rollout;
    const rolledOutUpdateGroup = rolledOutBranch.updateGroups[0];
    let outcome: EndOutcome;
    if (!rolledOutUpdateGroup) {
      Log.log(`⚠️  There is no update group being served on the ${rolledOutBranch.name} branch.`);
      assert(
        this.options.outcome !== EndOutcome.REPUBLISH_AND_REVERT,
        `The only valid outcome for this rollout is to revert users back to the ${rollout.defaultBranch.name} branch. `
      );
      outcome = EndOutcome.REVERT;
    } else {
      outcome = this.options.outcome ?? (await this.selectOutcomeAsync(rollout));
    }
    const didConfirm = await this.confirmOutcomeAsync(ctx, outcome, rollout);
    if (!didConfirm) {
      throw new Error('Aborting...');
    }
    return await this.performOutcomeAsync(ctx, rollout, outcome);
  }

  private async runForConstrainedRolloutAsync(
    ctx: EASUpdateContext,
    rolloutInfo: ConstrainedRolloutInfo[]
  ): Promise<UpdateChannelBasicInfoFragment> {
    const { graphqlClient, app } = ctx;
    const { projectId } = app;

    // check for no constrained rollout
    if (rolloutInfo.length < 1) {
      throw new Error(
        `The channel ${chalk.bold(
          this.channelInfo.name
        )} does not have a rollout. To end a rollout, you must specify a channel with an ongoing rollout.`
      );
    }

    // if rollout length === 1, we can infer runtime version (to make addition of the flag a non-breaking change)
    let inferredRuntimeVersion;
    if (rolloutInfo.length === 1) {
      inferredRuntimeVersion = this.options.runtimeVersion ?? rolloutInfo[0].runtimeVersion;
    } else {
      const { nonInteractive } = ctx;
      if (nonInteractive) {
        assertConstrainedRolloutNonInteractiveOptions(this.options);
      }
      inferredRuntimeVersion =
        this.options.runtimeVersion ?? (await this.selectRuntimeVersionAsync(rolloutInfo));
    }

    const runtimeVersion = inferredRuntimeVersion;

    const channelObject = await ChannelQuery.viewUpdateChannelAsync(graphqlClient, {
      appId: projectId,
      channelName: this.channelInfo.name,
      filter: { runtimeVersions: [runtimeVersion] },
    });
    const rollout = getConstrainedRolloutForRtv(channelObject, runtimeVersion);
    const { rolledOutBranch } = rollout;
    const rolledOutUpdateGroup = rolledOutBranch.updateGroups[0];
    let outcome: EndOutcome;
    if (!rolledOutUpdateGroup) {
      Log.log(`⚠️  There is no update group being served on the ${rolledOutBranch.name} branch.`);
      assert(
        this.options.outcome !== EndOutcome.REPUBLISH_AND_REVERT,
        `The only valid outcome for this rollout is to revert users back to the ${rollout.defaultBranch.name} branch. `
      );
      outcome = EndOutcome.REVERT;
    } else {
      outcome = this.options.outcome ?? (await this.selectOutcomeAsync(rollout));
    }
    const didConfirm = await this.confirmOutcomeAsync(ctx, outcome, rollout);
    if (!didConfirm) {
      throw new Error('Aborting...');
    }
    return await this.performOutcomeAsync(ctx, rollout, outcome);
  }

  public async runAsync(ctx: EASUpdateContext): Promise<UpdateChannelBasicInfoFragment> {
    const { nonInteractive } = ctx;
    if (nonInteractive) {
      assertNonInteractiveOptions(this.options);
    }

    Log.log(
      `⚠️  The ${EndOutcome.REPUBLISH_AND_REVERT} and ${EndOutcome.REVERT} values for the outcome flag are deprecated.`
    );

    const rolloutInfo = getRolloutInfo(this.channelInfo);
    if (isLegacyRolloutInfo(rolloutInfo)) {
      return this.runForLegacyRolloutAsync(ctx);
    } else {
      return this.runForConstrainedRolloutAsync(ctx, rolloutInfo);
    }
  }

  async selectOutcomeAsync(rollout: Rollout<UpdateBranchObject>): Promise<EndOutcome> {
    const { rolledOutBranch, percentRolledOut, defaultBranch } = rollout;
    const rolledOutUpdateGroup = rolledOutBranch.updateGroups[0];
    const defaultUpdateGroup = defaultBranch.updateGroups[0];
    const outcomes = [
      {
        value: EndOutcome.REPUBLISH_AND_REVERT,
        title: formatBranchWithUpdateGroup(rolledOutUpdateGroup, rolledOutBranch, percentRolledOut),
      },
      {
        value: EndOutcome.REVERT,
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
    if (selectedOutcome === EndOutcome.REPUBLISH_AND_REVERT) {
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
    outcome: EndOutcome
  ): Promise<UpdateChannelBasicInfoFragment> {
    const { graphqlClient, app } = ctx;
    const { rolledOutBranch, defaultBranch } = rollout;
    const rolledOutUpdateGroup = rolledOutBranch.updateGroups[0];
    if (outcome === EndOutcome.REPUBLISH_AND_REVERT) {
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
    Log.log(`⬅️ Reverted all users back to branch ${chalk.bold(defaultBranch.name)}`);
    Log.log(`✅ Successfully ended rollout`);
    return newChannelInfo;
  }

  async confirmOutcomeAsync(
    ctx: EASUpdateContext,
    selectedOutcome: EndOutcome,
    rollout: Rollout<UpdateBranchObject>
  ): Promise<boolean> {
    const { nonInteractive } = ctx;
    if (nonInteractive) {
      return true;
    }
    const { rolledOutBranch, defaultBranch } = rollout;
    Log.newLine();
    if (selectedOutcome === EndOutcome.REPUBLISH_AND_REVERT) {
      Log.log(`Ending the rollout will do the following:`);
      const actions = formatFields([
        {
          label: '1.',
          value: `🔁 Republish the update group from ${chalk.bold(
            rolledOutBranch.name
          )} onto ${chalk.bold(defaultBranch.name)}`,
        },
        { label: '2.', value: `⬅️  Revert all users back to ${chalk.bold(defaultBranch.name)}` },
      ]);
      Log.log(actions);
    } else {
      Log.log(
        `⬅️  Ending the rollout will revert all users back to ${chalk.bold(defaultBranch.name)}`
      );
    }
    return await confirmAsync({
      message: `Continue?`,
    });
  }

  async selectRuntimeVersionAsync(rolloutInfo: ConstrainedRolloutInfo[]): Promise<string> {
    const runtimeVersions = rolloutInfo.map(
      constrainedRolloutInfo => constrainedRolloutInfo.runtimeVersion
    );
    const { runtimeVersion } = await promptAsync({
      type: 'select',
      name: 'runtimeVersion',
      message: `Which runtime version rollout would you like to end?`,
      choices: runtimeVersions.map(rtv => ({
        value: rtv,
        title: rtv,
      })),
    });

    if (!runtimeVersion) {
      throw new Error('Must select a runtime version');
    }

    return runtimeVersion;
  }
}
