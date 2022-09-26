import { listAndRenderBranchesOnAppAsync } from '../../branch/queries';
import EasCommand, { EASCommandProjectConfigContext } from '../../commandUtils/EasCommand';
import { EasNonInteractiveAndJsonFlags } from '../../commandUtils/flags';
import { EasPaginatedQueryFlags, getPaginatedQueryOptions } from '../../commandUtils/pagination';
import { enableJsonOutput } from '../../utils/json';

export default class BranchList extends EasCommand {
  static override description = 'list all branches';

  static override flags = {
    ...EasPaginatedQueryFlags,
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...EASCommandProjectConfigContext,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(BranchList);
    const {
      projectConfig: { projectId },
    } = await this.getContextAsync(BranchList, {
      nonInteractive: flags['non-interactive'],
    });
    const paginatedQueryOptions = getPaginatedQueryOptions(flags);

    if (paginatedQueryOptions.json) {
      enableJsonOutput();
    }

    await listAndRenderBranchesOnAppAsync({ projectId, paginatedQueryOptions });
  }
}
