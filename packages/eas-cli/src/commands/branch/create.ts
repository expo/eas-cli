import { getConfig } from '@expo/config';
import { flags } from '@oclif/command';
import chalk from 'chalk';
import gql from 'graphql-tag';

import EasCommand from '../../commandUtils/EasCommand';
import { graphqlClient, withErrorHandlingAsync } from '../../graphql/client';
import {
  CreateUpdateBranchForAppMutation,
  CreateUpdateBranchForAppMutationVariables,
  UpdateBranch,
} from '../../graphql/generated';
import Log from '../../log';
import {
  findProjectRootAsync,
  getProjectFullNameAsync,
  getProjectIdAsync,
} from '../../project/projectUtils';
import { promptAsync } from '../../prompts';
import { getVcsClient } from '../../vcs';

export async function createUpdateBranchOnAppAsync({
  appId,
  name,
}: CreateUpdateBranchForAppMutationVariables): Promise<Pick<UpdateBranch, 'id' | 'name'>> {
  const result = await withErrorHandlingAsync(
    graphqlClient
      .mutation<CreateUpdateBranchForAppMutation, CreateUpdateBranchForAppMutationVariables>(
        gql`
          mutation createUpdateBranchForApp($appId: ID!, $name: String!) {
            updateBranch {
              createUpdateBranchForApp(appId: $appId, name: $name) {
                id
                name
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
  const newBranch = result.updateBranch.createUpdateBranchForApp;
  if (!newBranch) {
    throw new Error(`Could not create branch ${name}.`);
  }
  return newBranch;
}

export default class BranchCreate extends EasCommand {
  static hidden = true;
  static description = 'Create a branch on the current project.';

  static args = [
    {
      name: 'name',
      required: false,
      description: 'Name of the branch to create',
    },
  ];

  static flags = {
    json: flags.boolean({
      description: 'return a json with the new branch ID and name.',
      default: false,
    }),
  };

  async runAsync(): Promise<void> {
    let {
      args: { name },
      flags,
    } = this.parse(BranchCreate);

    const projectDir = await findProjectRootAsync();
    const { exp } = getConfig(projectDir, { skipSDKVersionRequirement: true });
    const fullName = await getProjectFullNameAsync(exp);
    const projectId = await getProjectIdAsync(exp);

    if (!name) {
      const validationMessage = 'Branch name may not be empty.';
      if (flags.json) {
        throw new Error(validationMessage);
      }
      ({ name } = await promptAsync({
        type: 'text',
        name: 'name',
        message: 'Please name the branch:',
        initial:
          (await getVcsClient().getBranchNameAsync()) ||
          `branch-${Math.random().toString(36).substr(2, 4)}`,
        validate: value => (value ? true : validationMessage),
      }));
    }

    const newBranch = await createUpdateBranchOnAppAsync({ appId: projectId, name });

    if (flags.json) {
      Log.log(newBranch);
      return;
    }

    Log.withTick(
      `️Created a new branch: ${chalk.bold(newBranch.name)} on project ${chalk.bold(fullName)}.`
    );
  }
}
