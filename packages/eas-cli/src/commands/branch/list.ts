import { listAndRenderBranchesOnAppAsync } from '../../branch/queries';
import EasCommand from '../../commandUtils/EasCommand';
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
    ...this.ContextOptions.ProjectId,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(BranchList);
    const {
      projectId,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(BranchList, {
      nonInteractive: flags['non-interactive'],
    });
    const paginatedQueryOptions = getPaginatedQueryOptions(flags);

    if (paginatedQueryOptions.json) {
      enableJsonOutput();
    }

    await listAndRenderBranchesOnAppAsync(graphqlClient, { projectId, paginatedQueryOptions });
  }
}
