import assert from 'assert';
import chalk from 'chalk';

import { updateChannelBranchMappingAsync } from '../../commands/channel/edit';
import { EASUpdateAction, EASUpdateContext } from '../../eas-update/utils';
import { UpdateChannelBasicInfoFragment } from '../../graphql/generated';
import { ChannelQuery, UpdateChannelObject } from '../../graphql/queries/ChannelQuery';
import Log from '../../log';
import { confirmAsync } from '../../prompts';
import {
  editRolloutBranchMapping,
  getRollout,
  getRolloutBranchMapping,
  getRolloutInfo,
  isConstrainedRolloutInfo,
  isRollout,
} from '../branch-mapping';
import { promptForRolloutPercentAsync } from '../utils';

export type NonInteractiveOptions = {
  percent: number;
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

/**
 * Edit an existing rollout for the project.
 */
export class EditRollout implements EASUpdateAction<UpdateChannelBasicInfoFragment> {
  constructor(
    private readonly channelInfo: UpdateChannelBasicInfoFragment,
    private readonly options: Partial<NonInteractiveOptions> = {}
  ) {}

  public async runAsync(ctx: EASUpdateContext): Promise<UpdateChannelBasicInfoFragment> {
    const { nonInteractive, graphqlClient } = ctx;
    if (nonInteractive) {
      assertNonInteractiveOptions(this.options);
    }
    const channelObject = await this.getChannelObjectAsync(ctx);
    const rollout = getRollout(channelObject);
    const { rolledOutBranch, defaultBranch } = rollout;
    const promptMessage = `What percent of users should be rolled out to the ${rolledOutBranch.name} branch ?`;
    const percent = this.options.percent ?? (await promptForRolloutPercentAsync({ promptMessage }));

    if (percent === 0 || percent === 100) {
      Log.warn(
        `Editing the percent to ${percent} will not end the rollout. You'll need to end the rollout from the main menu.`
      );
    }

    const oldBranchMapping = getRolloutBranchMapping(channelObject.branchMapping);
    const newBranchMapping = editRolloutBranchMapping(oldBranchMapping, percent);

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

  async confirmEditAsync(ctx: EASUpdateContext): Promise<boolean> {
    const { nonInteractive } = ctx;
    if (nonInteractive) {
      return true;
    }
    return await confirmAsync({
      message: `Confirm changes?`,
    });
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
}
