import { BRANCHES_LIMIT, selectBranchForProjectAsync } from '../../branch/queries';
import EasCommand from '../../commandUtils/EasCommand';
import { EasFlags } from '../../commandUtils/flagHelpers';
import { getExpoConfig } from '../../project/expoConfig';
import { findProjectRootAsync, getProjectIdAsync } from '../../project/projectUtils';
import { queryUpdatesOnBranchByNameAsync } from '../../update/queries';
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
    'non-interactive': EasFlags['non-interactive'],
    json: EasFlags.json,
    limit: EasFlags.limit,
    offset: EasFlags.offset,
  };

  async runAsync(): Promise<void> {
    let {
      args: { name: branchName },
      flags,
    } = await this.parse(BranchView);
    if (flags.json) {
      enableJsonOutput();
    }

    const projectDir = await findProjectRootAsync();
    const exp = getExpoConfig(projectDir);
    const projectId = await getProjectIdAsync(exp);

    if (!branchName) {
      ({ name: branchName } = await selectBranchForProjectAsync(
        projectId,
        'Which branch would you like to view?',
        { ...flags, offset: 0, limit: BRANCHES_LIMIT }
      ));
    }

    await queryUpdatesOnBranchByNameAsync(projectId, branchName, flags);
  }
}
