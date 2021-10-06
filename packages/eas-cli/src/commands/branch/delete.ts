import { getConfig } from '@expo/config';
import { flags } from '@oclif/command';
import chalk from 'chalk';
import gql from 'graphql-tag';

import EasCommand from '../../commandUtils/EasCommand';
import { graphqlClient, withErrorHandlingAsync } from '../../graphql/client';
import {
  DeleteUpdateBranchMutation,
  DeleteUpdateBranchMutationVariables,
  DeleteUpdateBranchResult,
  GetBranchInfoQuery,
  GetBranchInfoQueryVariables,
} from '../../graphql/generated';
import Log from '../../log';
import {
  findProjectRootAsync,
  getProjectFullNameAsync,
  getProjectIdAsync,
} from '../../project/projectUtils';
import { promptAsync, toggleConfirmAsync } from '../../prompts';

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
        }
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
  static hidden = true;
  static description = 'Republish an update group';

  static args = [
    {
      name: 'name',
      required: false,
      description: 'Name of the branch to delete',
    },
  ];
  static flags = {
    json: flags.boolean({
      description: `return JSON with the edited branch's ID and name.`,
      default: false,
    }),
  };

  async runAsync(): Promise<void> {
    let {
      args: { name },
      flags: { json: jsonFlag },
    } = this.parse(BranchDelete);

    const projectDir = await findProjectRootAsync();
    const { exp } = getConfig(projectDir, { skipSDKVersionRequirement: true });
    const fullName = await getProjectFullNameAsync(exp);
    const projectId = await getProjectIdAsync(exp);

    if (!name) {
      const validationMessage = 'branch name may not be empty.';
      if (jsonFlag) {
        throw new Error(validationMessage);
      }
      ({ name } = await promptAsync({
        type: 'text',
        name: 'name',
        message: 'Please enter the name of the branch to delete:',
        validate: value => (value ? true : validationMessage),
      }));
    }

    const data = await getBranchInfoAsync({ appId: projectId, name });
    const branchId = data.app?.byId.updateBranchByName?.id;
    if (!branchId) {
      throw new Error(`Could not find branch ${name} on ${fullName}`);
    }

    if (!jsonFlag) {
      Log.addNewLineIfNone();
      Log.warn(
        `You are about to permamently delete branch: "${name}" and all of the updates published on it.` +
          `\nThis action is irreversible.`
      );
      Log.newLine();
      const confirmed = await toggleConfirmAsync({ message: 'Are you sure you wish to proceed?' });
      if (!confirmed) {
        Log.error(`Cancelled deletion of branch: "${name}".`);
        process.exit(1);
      }
    }

    const deletionResult = await deleteBranchOnAppAsync({
      branchId,
    });

    if (jsonFlag) {
      Log.log(JSON.stringify(deletionResult));
    }

    Log.withTick(
      `️Deleted branch "${name}" and all of its updates on project ${chalk.bold(fullName)}.`
    );
  }
}
