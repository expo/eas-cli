import { CHANNELS_LIMIT, listAndRenderChannelsOnAppAsync } from '../../channel/queries';
import EasCommand from '../../commandUtils/EasCommand';
import { EasNonInteractiveAndJsonFlags } from '../../commandUtils/flags';
import {
  EasPaginatedQueryFlags,
  getLimitFlagWithCustomValues,
  getPaginatedQueryOptions,
} from '../../commandUtils/pagination';
import { enableJsonOutput } from '../../utils/json';

export default class ChannelList extends EasCommand {
  static override description = 'list all channels';

  static override flags = {
    ...EasPaginatedQueryFlags,
    limit: getLimitFlagWithCustomValues({ defaultTo: 10, limit: CHANNELS_LIMIT }),
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectId,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(ChannelList);
    const paginatedQueryOptions = getPaginatedQueryOptions(flags);
    const { json: jsonFlag, 'non-interactive': nonInteractive } = flags;
    const {
      projectId,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(ChannelList, {
      nonInteractive,
    });
    if (jsonFlag) {
      enableJsonOutput();
    }

    await listAndRenderChannelsOnAppAsync(graphqlClient, {
      projectId,
      paginatedQueryOptions,
    });
  }
}
