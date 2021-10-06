import { getConfig } from '@expo/config';
import { flags } from '@oclif/command';
import chalk from 'chalk';
import gql from 'graphql-tag';

import EasCommand from '../../commandUtils/EasCommand';
import { graphqlClient, withErrorHandlingAsync } from '../../graphql/client';
import {
  EditUpdateBranchInput,
  EditUpdateBranchMutation,
  EditUpdateBranchMutationVariables,
  UpdateBranch,
} from '../../graphql/generated';
import Log from '../../log';
import {
  findProjectRootAsync,
  getProjectFullNameAsync,
  getProjectIdAsync,
} from '../../project/projectUtils';
import { promptAsync } from '../../prompts';

async function renameUpdateBranchOnAppAsync({
  appId,
  name,
  newName,
}: EditUpdateBranchInput): Promise<Pick<UpdateBranch, 'id' | 'name'>> {
  const data = await withErrorHandlingAsync(
    graphqlClient
      .mutation<EditUpdateBranchMutation, EditUpdateBranchMutationVariables>(
        gql`
          mutation EditUpdateBranch($input: EditUpdateBranchInput!) {
            updateBranch {
              editUpdateBranch(input: $input) {
                id
                name
              }
            }
          }
        `,
        {
          input: {
            appId,
            name,
            newName,
          },
        }
      )
      .toPromise()
  );
  return data.updateBranch.editUpdateBranch;
}

export default class BranchRename extends EasCommand {
  static hidden = true;
  static description = 'Rename a branch.';

  static flags = {
    from: flags.string({
      description: 'current name of the branch.',
      required: false,
    }),
    to: flags.string({
      description: 'new name of the branch.',
      required: false,
    }),
    json: flags.boolean({
      description: `return a json with the edited branch's ID and name.`,
      default: false,
    }),
  };

  async runAsync(): Promise<void> {
    let {
      flags: { json: jsonFlag, from: currentName, to: newName },
    } = this.parse(BranchRename);

    const projectDir = await findProjectRootAsync();
    const { exp } = getConfig(projectDir, { skipSDKVersionRequirement: true });
    const fullName = await getProjectFullNameAsync(exp);
    const projectId = await getProjectIdAsync(exp);

    if (!currentName) {
      const validationMessage = 'current name may not be empty.';
      if (jsonFlag) {
        throw new Error(validationMessage);
      }
      ({ currentName } = await promptAsync({
        type: 'text',
        name: 'currentName',
        message: 'Please enter the current name of the branch to rename:',
        validate: value => (value ? true : validationMessage),
      }));
    }

    if (!newName) {
      const validationMessage = 'new name may not be empty.';
      if (jsonFlag) {
        throw new Error(validationMessage);
      }
      ({ newName } = await promptAsync({
        type: 'text',
        name: 'newName',
        message: `Please rename ${currentName}`,
        validate: value => (value ? true : validationMessage),
      }));
    }

    const editedBranch = await renameUpdateBranchOnAppAsync({
      appId: projectId,
      name: currentName!,
      newName: newName!,
    });

    if (jsonFlag) {
      Log.log(JSON.stringify(editedBranch));
      return;
    }

    Log.withTick(
      `️Renamed branch from ${currentName} to ${chalk.bold(
        editedBranch.name
      )} on project ${chalk.bold(fullName)}.`
    );
  }
}
