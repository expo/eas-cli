import { selectBranchOnAppAsync } from '../../branch/queries';
import EasCommand from '../../commandUtils/EasCommand';
import {
  EasPaginatedQueryFlags,
  getLimitFlagWithCustomValues,
  getPaginatedQueryOptions,
} from '../../commandUtils/pagination';
import { getExpoConfig } from '../../project/expoConfig';
import { findProjectRootAsync, getProjectIdAsync } from '../../project/projectUtils';
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
    limit: getLimitFlagWithCustomValues({ defaultTo: 25, limit: 50 }),
  };

  async runAsync(): Promise<void> {
    let {
      args: { name: branchName },
      flags,
    } = await this.parse(BranchView);
    const paginatedQueryOptions = getPaginatedQueryOptions(flags);

    if (paginatedQueryOptions.json) {
      enableJsonOutput();
    }

    const projectDir = await findProjectRootAsync();
    const exp = getExpoConfig(projectDir);
    const projectId = await getProjectIdAsync(exp);

    if (!branchName) {
      if (paginatedQueryOptions.nonInteractive) {
        throw new Error('Branch name may not be empty.');
      }

      ({ name: branchName } = await selectBranchOnAppAsync({
        projectId,
        promptTitle: 'Which branch would you like to view?',
        displayTextForListItem: updateBranch => updateBranch.name,
        // discard limit and offset because this query is not their intended target
        paginatedQueryOptions: {
          json: paginatedQueryOptions.json,
          nonInteractive: paginatedQueryOptions.nonInteractive,
          offset: 0,
        },
      }));
    }

    await listAndRenderUpdateGroupsOnBranchAsync({ projectId, branchName, paginatedQueryOptions });
  }
}
