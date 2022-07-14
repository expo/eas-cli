import { queryForBranchesAsync } from '../../branch/queries';
import EasCommand from '../../commandUtils/EasCommand';
import { EasFlags } from '../../commandUtils/flagHelpers';
import { getExpoConfig } from '../../project/expoConfig';
import { findProjectRootAsync, getProjectIdAsync } from '../../project/projectUtils';
import { enableJsonOutput } from '../../utils/json';

export default class BranchList extends EasCommand {
  static description = 'list all branches';

  static flags = {
    'non-interactive': EasFlags['non-interactive'],
    json: EasFlags.json,
    limit: EasFlags.limit,
    offset: EasFlags.offset,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(BranchList);

    if (flags.json) {
      enableJsonOutput();
    }

    const projectDir = await findProjectRootAsync();
    const exp = getExpoConfig(projectDir);
    const projectId = await getProjectIdAsync(exp);
    await queryForBranchesAsync(projectId, flags);
  }
}
