import { selectBranchOnAppAsync } from '../../branch/queries';
import EasCommand from '../../commandUtils/EasCommand';
import { EasNonInteractiveAndJsonFlags } from '../../commandUtils/flags';
import {
  EasPaginatedQueryFlags,
  getLimitFlagWithCustomValues,
  getPaginatedQueryOptions,
} from '../../commandUtils/pagination';
import { listAndRenderUpdateGroupsOnBranchAsync } from '../../update/queries';
import { enableJsonOutput } from '../../utils/json';

export default class BranchView extends EasCommand {
  static override description = 'view a branch';

  static override args = [
    {
      name: 'name',
      required: false,
      description: 'Name of the branch to view',
    },
  ];

  static override flags = {
    ...EasPaginatedQueryFlags,
    ...EasNonInteractiveAndJsonFlags,
    limit: getLimitFlagWithCustomValues({ defaultTo: 25, limit: 50 }),
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectId,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    let {
      args: { name: branchName },
      flags,
    } = await this.parse(BranchView);
    const { 'non-interactive': nonInteractive } = flags;
    const {
      projectId,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(BranchView, {
      nonInteractive,
    });
    const paginatedQueryOptions = getPaginatedQueryOptions(flags);

    if (paginatedQueryOptions.json) {
      enableJsonOutput();
    }

    if (!branchName) {
      if (nonInteractive) {
        throw new Error('Branch name may not be empty.');
      }

      ({ name: branchName } = await selectBranchOnAppAsync(graphqlClient, {
        projectId,
        promptTitle: 'Which branch would you like to view?',
        displayTextForListItem: updateBranch => ({
          title: updateBranch.name,
        }),
        // discard limit and offset because this query is not their intended target
        paginatedQueryOptions: {
          json: paginatedQueryOptions.json,
          nonInteractive,
          offset: 0,
        },
      }));
    }

    await listAndRenderUpdateGroupsOnBranchAsync(graphqlClient, {
      projectId,
      branchName,
      paginatedQueryOptions,
    });
  }
}
