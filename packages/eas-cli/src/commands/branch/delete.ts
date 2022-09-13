import chalk from 'chalk';
import gql from 'graphql-tag';

import EasCommand, { CommandContext } from '../../commandUtils/EasCommand';
import { graphqlClient, withErrorHandlingAsync } from '../../graphql/client';
import {
  DeleteUpdateBranchMutation,
  DeleteUpdateBranchMutationVariables,
  DeleteUpdateBranchResult,
  GetBranchInfoQuery,
  GetBranchInfoQueryVariables,
} from '../../graphql/generated';
import { getExpoConfig } from '../../project/expoConfig';
import {
  findProjectRootAsync,
  getProjectFullNameAsync,
  getProjectIdAsync,
} from '../../project/projectUtils';

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

  protected async runAsync({
    nonInteractive,
    logger,
    prompts: { promptAsync, toggleConfirmAsync },
  }: CommandContext): Promise<{ jsonOutput: object }> {
    let {
      args: { name },
    } = await this.parse(BranchDelete);

    const projectDir = await findProjectRootAsync();
    const exp = getExpoConfig(projectDir);
    const fullName = await getProjectFullNameAsync(exp);
    const projectId = await getProjectIdAsync(exp);

    if (!name) {
      const validationMessage = 'branch name may not be empty.';
      if (nonInteractive) {
        throw new Error(validationMessage);
      }
      ({ name } = await promptAsync({
        type: 'text',
        name: 'name',
        message: 'Provide the name of the branch to delete:',
        validate: value => (value ? true : validationMessage),
      }));
    }

    const data = await getBranchInfoAsync({ appId: projectId, name });
    const branchId = data.app?.byId.updateBranchByName?.id;
    if (!branchId) {
      throw new Error(`Could not find branch ${name} on ${fullName}`);
    }

    if (!nonInteractive) {
      logger.addNewLineIfNone();
      logger.warn(
        `You are about to permanently delete branch: "${name}" and all of the updates published on it.` +
          `\nThis action is irreversible.`
      );
      logger.newLine();
      const confirmed = await toggleConfirmAsync({ message: 'Are you sure you wish to proceed?' });
      if (!confirmed) {
        logger.error(`Cancelled deletion of branch: "${name}".`);
        process.exit(1);
      }
    }

    const deletionResult = await deleteBranchOnAppAsync({
      branchId,
    });

    logger.withTick(
      `Deleted branch "${name}" and all of its updates on project ${chalk.bold(fullName)}.`
    );

    return { jsonOutput: deletionResult };
  }
}
