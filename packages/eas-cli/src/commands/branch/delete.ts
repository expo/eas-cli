import { getConfig } from '@expo/config';
import { Command, flags } from '@oclif/command';
import chalk from 'chalk';
import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../../graphql/client';
import {
  DeleteUpdateBranchMutation,
  DeleteUpdateBranchMutationVariables,
  DeleteUpdateBranchResult,
  GetBranchInfoQuery,
  GetBranchInfoQueryVariables,
} from '../../graphql/generated';
import Log from '../../log';
import { ensureProjectExistsAsync } from '../../project/ensureProjectExists';
import { findProjectRootAsync, getProjectAccountName } from '../../project/projectUtils';
import { promptAsync, toggleConfirmAsync } from '../../prompts';
import { ensureLoggedInAsync } from '../../user/actions';

async function getBranchInfoAsync({
  appId,
  name,
}: GetBranchInfoQueryVariables): Promise<{ branchId: string }> {
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
  const branchId = data.app?.byId.updateBranchByName.id;
  if (!branchId) {
    throw new Error(`Could not find branch ${name} on ${appId}`);
  }
  return { branchId };
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

export default class BranchDelete extends Command {
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

  async run() {
    let {
      args: { name },
      flags: { json: jsonFlag },
    } = this.parse(BranchDelete);

    const projectDir = await findProjectRootAsync(process.cwd());
    if (!projectDir) {
      throw new Error('Please run this command inside a project directory.');
    }
    const { exp } = await getConfig(projectDir, { skipSDKVersionRequirement: true });
    const accountName = getProjectAccountName(exp, await ensureLoggedInAsync());
    const projectId = await ensureProjectExistsAsync({
      accountName,
      projectName: exp.slug,
    });

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

    const { branchId } = await getBranchInfoAsync({ appId: projectId, name });

    if (!jsonFlag) {
      Log.addNewLineIfNone();
      Log.warn(
        `You are about to permamently delete branch: "${name}" and all of the updates published on it.` +
          `\nThis action is irreversable.`
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
      `️Deleted branch "${name}" and all of its updates on project ${chalk.bold(
        `@${accountName}/${exp.slug}`
      )}.`
    );
  }
}
