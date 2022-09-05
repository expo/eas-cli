import { listAndRenderPaginatedBranchesAsync } from '../../branch/queries';
import EasCommand from '../../commandUtils/EasCommand';
import { EasPaginatedQueryFlags, getPaginatedQueryOptions } from '../../commandUtils/pagination';
import { getExpoConfig } from '../../project/expoConfig';
import { findProjectRootAsync, getProjectIdAsync } from '../../project/projectUtils';
import { enableJsonOutput } from '../../utils/json';

export default class BranchList extends EasCommand {
  static override description = 'list all branches';

  static override flags = {
    ...EasPaginatedQueryFlags,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(BranchList);
    const options = getPaginatedQueryOptions(flags);

    if (options.json) {
      enableJsonOutput();
    }

    const projectDir = await findProjectRootAsync();
    const exp = getExpoConfig(projectDir);
    const projectId = await getProjectIdAsync(exp);
    await listAndRenderPaginatedBranchesAsync(projectId, options);
  }
}
