import { CHANNELS_LIMIT, listAndRenderChannelsOnAppAsync } from '../../channel/queries';
import EasCommand from '../../commandUtils/EasCommand';
import { EasNonInteractiveAndJsonFlags } from '../../commandUtils/flags';
import {
  EasPaginatedQueryFlags,
  getLimitFlagWithCustomValues,
  getPaginatedQueryOptions,
} from '../../commandUtils/pagination';
import { getExpoConfig } from '../../project/expoConfig';
import { findProjectRootAsync, getProjectIdAsync } from '../../project/projectUtils';
import { enableJsonOutput } from '../../utils/json';

export default class ChannelList extends EasCommand {
  static override description = 'list all channels';

  static override flags = {
    ...EasPaginatedQueryFlags,
    limit: getLimitFlagWithCustomValues({ defaultTo: 10, limit: CHANNELS_LIMIT }),
    ...EasNonInteractiveAndJsonFlags,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(ChannelList);
    const paginatedQueryOptions = getPaginatedQueryOptions(flags);
    const { json: jsonFlag } = flags;
    if (jsonFlag) {
      enableJsonOutput();
    }

    const projectDir = await findProjectRootAsync();
    const exp = getExpoConfig(projectDir);
    const projectId = await getProjectIdAsync(exp);

    await listAndRenderChannelsOnAppAsync({
      projectId,
      paginatedQueryOptions,
    });
  }
}
