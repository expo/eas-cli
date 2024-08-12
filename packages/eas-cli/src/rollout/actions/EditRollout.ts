import assert from 'assert';
import chalk from 'chalk';

import { getBranchMapping } from '../../channel/branch-mapping';
import { updateChannelBranchMappingAsync } from '../../commands/channel/edit';
import { EASUpdateAction, EASUpdateContext } from '../../eas-update/utils';
import { UpdateChannelBasicInfoFragment } from '../../graphql/generated';
import { ChannelQuery } from '../../graphql/queries/ChannelQuery';
import Log from '../../log';
import { confirmAsync, promptAsync } from '../../prompts';
import {
  ConstrainedRolloutInfo,
  editLegacyRollout,
  editRtvConstrainedRolloutForRtv,
  getConstrainedRolloutForRtv,
  getLegacyRollout,
  getRolloutInfo,
  isLegacyRolloutInfo,
  isUnconstrainedRollout,
} from '../branch-mapping';
import { promptForRolloutPercentAsync } from '../utils';

export type NonInteractiveOptions = {
  percent: number;
  runtimeVersion?: string;
};
function isNonInteractiveOptions(
  options: Partial<NonInteractiveOptions>
): options is NonInteractiveOptions {
  return !!options.percent;
}
function assertNonInteractiveOptions(
  options: Partial<NonInteractiveOptions>
): asserts options is NonInteractiveOptions {
  assert(
    isNonInteractiveOptions(options),
    '--percent is required for editing a rollout in non-interactive mode.'
  );
}
function isConstrainedNonInteractiveOptions(
  options: Partial<NonInteractiveOptions>
): options is Required<NonInteractiveOptions> {
  return !!options.percent && !!options.runtimeVersion;
}
function assertConstrainedRolloutNonInteractiveOptions(
  options: Partial<NonInteractiveOptions>
): asserts options is Required<NonInteractiveOptions> {
  assert(
    isConstrainedNonInteractiveOptions(options),
    '--percent and --runtime-version are required for editing a rollout in non-interactive mode.'
  );
}

/**
 * Edit an existing rollout for the channel and runtime version.
 */
export class EditRollout implements EASUpdateAction<UpdateChannelBasicInfoFragment> {
  constructor(
    private channelInfo: UpdateChannelBasicInfoFragment,
    private options: Partial<NonInteractiveOptions> = {}
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

    const { rolledOutBranch, defaultBranch } = rollout;
    const promptMessage = `What percent of users should be rolled out to the ${rolledOutBranch.name} branch ?`;
    const percent = this.options.percent ?? (await promptForRolloutPercentAsync({ promptMessage }));

    if (percent === 0 || percent === 100) {
      Log.warn(
        `Editing the percent to ${percent} will not end the rollout. You'll need to end the rollout from the main menu.`
      );
    }

    const oldBranchMapping = getBranchMapping(channelObject.branchMapping);
    if (!isUnconstrainedRollout(oldBranchMapping)) {
      throw new Error('Not legacy rollout');
    }

    const newBranchMapping = editLegacyRollout(oldBranchMapping, percent);

    Log.newLine();
    Log.log(
      `📝 ${chalk.bold(percent)}% of users will be rolled out to the ${chalk.bold(
        rolledOutBranch.name
      )} branch and ${chalk.bold(100 - percent)}% will remain on the ${chalk.bold(
        defaultBranch.name
      )} branch.`
    );
    const confirmEdit = await this.confirmEditAsync(ctx);
    if (!confirmEdit) {
      throw new Error('Aborting...');
    }

    const newChannelInfo = await updateChannelBranchMappingAsync(graphqlClient, {
      channelId: channelObject.id,
      branchMapping: JSON.stringify(newBranchMapping),
    });

    Log.addNewLineIfNone();
    Log.log(`✅ Successfuly updated rollout`);
    return newChannelInfo;
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
        )} does not have a rollout. To edit a rollout, you must specify a channel with an ongoing rollout.`
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
    const { rolledOutBranch, defaultBranch } = rollout;
    const promptMessage = `What percent of users should be rolled out to the ${rolledOutBranch.name} branch ?`;
    const percent = this.options.percent ?? (await promptForRolloutPercentAsync({ promptMessage }));

    if (percent === 0 || percent === 100) {
      Log.warn(
        `Editing the percent to ${percent} will not end the rollout. You'll need to end the rollout from the main menu.`
      );
    }

    const oldBranchMapping = getBranchMapping(channelObject.branchMapping);
    const newBranchMapping = editRtvConstrainedRolloutForRtv(
      oldBranchMapping,
      runtimeVersion,
      percent
    );

    Log.newLine();
    Log.log(
      `📝 ${chalk.bold(percent)}% of users will be rolled out to the ${chalk.bold(
        rolledOutBranch.name
      )} branch and ${chalk.bold(100 - percent)}% will remain on the ${chalk.bold(
        defaultBranch.name
      )} branch.`
    );
    const confirmEdit = await this.confirmEditAsync(ctx);
    if (!confirmEdit) {
      throw new Error('Aborting...');
    }

    const newChannelInfo = await updateChannelBranchMappingAsync(graphqlClient, {
      channelId: channelObject.id,
      branchMapping: JSON.stringify(newBranchMapping),
    });

    Log.addNewLineIfNone();
    Log.log(`✅ Successfuly updated rollout`);
    return newChannelInfo;
  }

  public async runAsync(ctx: EASUpdateContext): Promise<UpdateChannelBasicInfoFragment> {
    const { nonInteractive } = ctx;
    if (nonInteractive) {
      assertNonInteractiveOptions(this.options);
    }

    const rolloutInfo = getRolloutInfo(this.channelInfo);
    if (isLegacyRolloutInfo(rolloutInfo)) {
      return this.runForLegacyRolloutAsync(ctx);
    } else {
      return this.runForConstrainedRolloutAsync(ctx, rolloutInfo);
    }
  }

  async confirmEditAsync(ctx: EASUpdateContext): Promise<boolean> {
    const { nonInteractive } = ctx;
    if (nonInteractive) {
      return true;
    }
    return await confirmAsync({
      message: `Confirm changes?`,
    });
  }

  async selectRuntimeVersionAsync(rolloutInfo: ConstrainedRolloutInfo[]): Promise<string> {
    const runtimeVersions = rolloutInfo.map(
      constrainedRolloutInfo => constrainedRolloutInfo.runtimeVersion
    );
    const { runtimeVersion } = await promptAsync({
      type: 'select',
      name: 'runtimeVersion',
      message: `Which runtime version rollout would you like to edit?`,
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
