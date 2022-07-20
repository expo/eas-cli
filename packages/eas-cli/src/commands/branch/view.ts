import { selectBranchFromPaginatedQueryAsync } from '../../branch/queries';
import EasCommand from '../../commandUtils/EasCommand';
import { EasPaginatedQueryFlags, getPaginatedQueryOptions } from '../../commandUtils/pagination';
import { getExpoConfig } from '../../project/expoConfig';
import { findProjectRootAsync, getProjectIdAsync } from '../../project/projectUtils';
import { listAndRenderUpdatesOnBranchByNameAsync } from '../../update/queries';
import { enableJsonOutput } from '../../utils/json';

export default class BranchView extends EasCommand {
  static description = 'view a branch';

  static args = [
    {
      name: 'name',
      required: false,
      description: 'Name of the branch to view',
    },
  ];

  static flags = {
    ...EasPaginatedQueryFlags,
  };

  async runAsync(): Promise<void> {
    let {
      args: { name: branchName },
      flags,
    } = await this.parse(BranchView);
    const options = getPaginatedQueryOptions(flags);

    if (options.json) {
      enableJsonOutput();
    }

    const projectDir = await findProjectRootAsync();
    const exp = getExpoConfig(projectDir);
    const projectId = await getProjectIdAsync(exp);

    // provide help to a user if they ran the command with missing args
    if (!branchName) {
      ({ name: branchName } = await selectBranchFromPaginatedQueryAsync(
        projectId,
        'Which branch would you like to view?',
        // discard limit and offset because this query is not those flag's intended target
        { json: options.json, nonInteractive: options.nonInteractive, offset: 0 }
      ));
    }

    await listAndRenderUpdatesOnBranchByNameAsync(projectId, branchName, options);
  }
}
