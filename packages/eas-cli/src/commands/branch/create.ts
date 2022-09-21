import chalk from 'chalk';
import gql from 'graphql-tag';

import { getDefaultBranchNameAsync } from '../../branch/utils';
import EasCommand, { EASCommandProjectIdContext } from '../../commandUtils/EasCommand';
import { EasNonInteractiveAndJsonFlags } from '../../commandUtils/flags';
import { graphqlClient, withErrorHandlingAsync } from '../../graphql/client';
import {
  CreateUpdateBranchForAppMutation,
  CreateUpdateBranchForAppMutationVariables,
  UpdateBranch,
} from '../../graphql/generated';
import Log from '../../log';
import { getDisplayNameForProjectIdAsync } from '../../project/projectUtils';
import { promptAsync } from '../../prompts';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

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
  static override description = 'create a branch';

  static override args = [
    {
      name: 'name',
      required: false,
      description: 'Name of the branch to create',
    },
  ];

  static override flags = {
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...EASCommandProjectIdContext,
  };

  async runAsync(): Promise<void> {
    let {
      args: { name },
      flags: { json: jsonFlag, 'non-interactive': nonInteractive },
    } = await this.parse(BranchCreate);
    const { projectId } = await this.getContextAsync(BranchCreate, {
      nonInteractive,
    });

    if (jsonFlag) {
      enableJsonOutput();
    }

    const projectDisplayName = await getDisplayNameForProjectIdAsync(projectId);

    if (!name) {
      const validationMessage = 'Branch name may not be empty.';
      if (nonInteractive) {
        throw new Error(validationMessage);
      }
      ({ name } = await promptAsync({
        type: 'text',
        name: 'name',
        message: 'Provide a branch name:',
        initial: await getDefaultBranchNameAsync(),
        validate: value => (value ? true : validationMessage),
      }));
    }

    const newBranch = await createUpdateBranchOnAppAsync({ appId: projectId, name });

    if (jsonFlag) {
      printJsonOnlyOutput(newBranch);
    } else {
      Log.withTick(
        `️Created a new branch: ${chalk.bold(newBranch.name)} on project ${chalk.bold(
          projectDisplayName
        )}.`
      );
    }
  }
}
