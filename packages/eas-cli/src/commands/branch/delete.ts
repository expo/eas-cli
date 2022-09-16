import chalk from 'chalk';
import gql from 'graphql-tag';

import { selectBranchOnAppAsync } from '../../branch/queries';
import EasCommand from '../../commandUtils/EasCommand';
import { EasNonInteractiveAndJsonFlags } from '../../commandUtils/flags';
import { getPaginatedQueryOptions } from '../../commandUtils/pagination';
import { graphqlClient, withErrorHandlingAsync } from '../../graphql/client';
import {
  DeleteUpdateBranchMutation,
  DeleteUpdateBranchMutationVariables,
  DeleteUpdateBranchResult,
  GetBranchInfoQuery,
  GetBranchInfoQueryVariables,
} from '../../graphql/generated';
import Log from '../../log';
import { getExpoConfig } from '../../project/expoConfig';
import {
  findProjectRootAsync,
  getProjectFullNameAsync,
  getProjectIdAsync,
} from '../../project/projectUtils';
import { toggleConfirmAsync } from '../../prompts';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

async function getBranchInfoAsync({
  appId,
  name,
}: GetBranchInfoQueryVariables): Promise<GetBranchInfoQuery> {
  const data = await withErrorHandlingAsync(
    graphqlClient
      .query<GetBranchInfoQuery, GetBranchInfoQueryVariables>(
        gql`
          query GetBranchInfo($appId: String!, $name: String!) {
            app {
              byId(appId: $appId) {
                id
                updateBranchByName(name: $name) {
                  id
                  name
                }
              }
            }
          }
        `,
        {
          appId,
          name,
        },
        { additionalTypenames: ['UpdateBranch'] }
      )
      .toPromise()
  );
  return data;
}

async function deleteBranchOnAppAsync({
  branchId,
}: DeleteUpdateBranchMutationVariables): Promise<DeleteUpdateBranchResult> {
  const data = await withErrorHandlingAsync(
    graphqlClient
      .mutation<DeleteUpdateBranchMutation, DeleteUpdateBranchMutationVariables>(
        gql`
          mutation DeleteUpdateBranch($branchId: ID!) {
            updateBranch {
              deleteUpdateBranch(branchId: $branchId) {
                id
              }
            }
          }
        `,
        {
          branchId,
        }
      )
      .toPromise()
  );
  return data.updateBranch.deleteUpdateBranch;
}

export default class BranchDelete extends EasCommand {
  static override description = 'delete a branch';

  static override args = [
    {
      name: 'name',
      required: false,
      description: 'Name of the branch to delete',
    },
  ];

  static override flags = {
    ...EasNonInteractiveAndJsonFlags,
  };

  async runAsync(): Promise<void> {
    let {
      args: { name: branchName },
      flags,
    } = await this.parse(BranchDelete);
    const paginatedQueryOptions = getPaginatedQueryOptions(flags);
    const { json: jsonFlag, 'non-interactive': nonInteractive } = flags;
    if (jsonFlag) {
      enableJsonOutput();
    }

    const projectDir = await findProjectRootAsync();
    const exp = getExpoConfig(projectDir);
    const fullName = await getProjectFullNameAsync(exp, { nonInteractive });
    const projectId = await getProjectIdAsync(exp, { nonInteractive });

    if (!branchName) {
      const validationMessage = 'branch name may not be empty.';
      if (nonInteractive) {
        throw new Error(validationMessage);
      }
      ({ name: branchName } = await selectBranchOnAppAsync({
        projectId,
        displayTextForListItem: updateBranch => updateBranch.name,
        promptTitle: 'Which branch would you like to delete?',
        paginatedQueryOptions,
      }));
    }

    const data = await getBranchInfoAsync({ appId: projectId, name: branchName });
    const branchId = data.app?.byId.updateBranchByName?.id;
    if (!branchId) {
      throw new Error(`Could not find branch ${branchName} on ${fullName}`);
    }

    if (!nonInteractive) {
      Log.addNewLineIfNone();
      Log.warn(
        `You are about to permanently delete branch: "${branchName}" and all of the updates published on it.` +
          `\nThis action is irreversible.`
      );
      Log.newLine();
      const confirmed = await toggleConfirmAsync({ message: 'Are you sure you wish to proceed?' });
      if (!confirmed) {
        Log.error(`Cancelled deletion of branch: "${branchName}".`);
        process.exit(1);
      }
    }

    const deletionResult = await deleteBranchOnAppAsync({
      branchId,
    });

    if (jsonFlag) {
      printJsonOnlyOutput(deletionResult);
    } else {
      Log.withTick(
        `️Deleted branch "${branchName}" and all of its updates on project ${chalk.bold(fullName)}.`
      );
    }
  }
}
