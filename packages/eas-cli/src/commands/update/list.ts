import { Flags } from '@oclif/core';

import { selectBranchOnAppAsync } from '../../branch/queries';
import EasCommand from '../../commandUtils/EasCommand';
import { EasNonInteractiveAndJsonFlags } from '../../commandUtils/flags';
import {
  EasPaginatedQueryFlags,
  getLimitFlagWithCustomValues,
  getPaginatedQueryOptions,
} from '../../commandUtils/pagination';
import { getExpoConfig } from '../../project/expoConfig';
import { findProjectRootAsync, getProjectIdAsync } from '../../project/projectUtils';
import {
  listAndRenderUpdateGroupsOnAppAsync,
  listAndRenderUpdateGroupsOnBranchAsync,
} from '../../update/queries';
import { enableJsonOutput } from '../../utils/json';

export default class UpdateList extends EasCommand {
  static override description = 'view the recent updates';

  static override flags = {
    branch: Flags.string({
      description: 'List updates only on this branch',
      exclusive: ['all'],
    }),
    all: Flags.boolean({
      description: 'List updates on all branches',
      exclusive: ['branch'],
      default: false,
    }),
    ...EasPaginatedQueryFlags,
    limit: getLimitFlagWithCustomValues({ defaultTo: 25, limit: 50 }),
    ...EasNonInteractiveAndJsonFlags,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(UpdateList);
    const { branch: branchFlag, all, json: jsonFlag } = flags;
    const paginatedQueryOptions = getPaginatedQueryOptions(flags);

    if (jsonFlag) {
      enableJsonOutput();
    }

    const projectDir = await findProjectRootAsync();
    const exp = getExpoConfig(projectDir);
    const projectId = await getProjectIdAsync(exp);

    if (all) {
      listAndRenderUpdateGroupsOnAppAsync({ projectId, paginatedQueryOptions });
    } else {
      if (branchFlag) {
        listAndRenderUpdateGroupsOnBranchAsync({
          projectId,
          branchName: branchFlag,
          paginatedQueryOptions,
        });
      } else {
        const validationMessage = 'Branch name may not be empty.';
        if (paginatedQueryOptions.nonInteractive) {
          throw new Error(validationMessage);
        }

        const selectedBranch = await selectBranchOnAppAsync({
          projectId,
          promptTitle: 'Which branch would you like to view?',
          displayTextForListItem: updateBranch => updateBranch.name,
          paginatedQueryOptions:
            // discard limit and offset because this query is not those flag's intended target
            {
              json: paginatedQueryOptions.json,
              nonInteractive: paginatedQueryOptions.nonInteractive,
              offset: 0,
            },
        });
        listAndRenderUpdateGroupsOnBranchAsync({
          projectId,
          branchName: selectedBranch.name,
          paginatedQueryOptions,
        });
      }
    }
  }
}
