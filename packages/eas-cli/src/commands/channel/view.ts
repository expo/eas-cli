import assert from 'assert';

import {
  listAndRenderBranchesAndUpdatesOnChannelAsync,
  selectChannelOnAppAsync,
} from '../../channel/queries';
import EasCommand from '../../commandUtils/EasCommand';
import { EasNonInteractiveAndJsonFlags } from '../../commandUtils/flags';
import { EasPaginatedQueryFlags, getPaginatedQueryOptions } from '../../commandUtils/pagination';
import { getExpoConfig } from '../../project/expoConfig';
import { findProjectRootAsync, getProjectIdAsync } from '../../project/projectUtils';
import { enableJsonOutput } from '../../utils/json';

export default class ChannelView extends EasCommand {
  static override description = 'view a channel';

  static override args = [
    {
      name: 'name',
      required: false,
      description: 'Name of the channel to view',
    },
  ];

  static override flags = {
    ...EasNonInteractiveAndJsonFlags,
    ...EasPaginatedQueryFlags,
  };

  async runAsync(): Promise<void> {
    let {
      args: { name: channelName },
      flags,
    } = await this.parse(ChannelView);
    const paginatedQueryOptions = getPaginatedQueryOptions(flags);
    const { json: jsonFlag, 'non-interactive': nonInteractive } = flags;
    if (jsonFlag) {
      enableJsonOutput();
    }

    const projectDir = await findProjectRootAsync();
    const exp = getExpoConfig(projectDir);
    const projectId = await getProjectIdAsync(exp, { nonInteractive });

    if (!channelName) {
      const validationMessage = 'A channel name is required to view a specific channel.';
      if (nonInteractive) {
        throw new Error(validationMessage);
      }
      const selectedUpdateChannel = await selectChannelOnAppAsync({
        projectId,
        selectionPromptTitle: 'Select a channel to view',
        paginatedQueryOptions: {
          json: jsonFlag,
          nonInteractive,
          offset: 0,
        },
      });
      channelName = selectedUpdateChannel.name;
      assert(channelName, `A channel must be selected.`);
    }

    await listAndRenderBranchesAndUpdatesOnChannelAsync({
      projectId,
      channelName,
      paginatedQueryOptions,
    });
  }
}
