import { getConfig } from '@expo/config';
import { Command, flags } from '@oclif/command';
import chalk from 'chalk';
import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../../graphql/client';
import {
  EditUpdateBranchInput,
  EditUpdateBranchMutation,
  EditUpdateBranchMutationVariables,
  UpdateBranch,
} from '../../graphql/generated';
import Log from '../../log';
import { ensureProjectExistsAsync } from '../../project/ensureProjectExists';
import { findProjectRootAsync, getProjectAccountName } from '../../project/projectUtils';
import { promptAsync } from '../../prompts';
import { ensureLoggedInAsync } from '../../user/actions';

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

export default class BranchRename extends Command {
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

  async run() {
    let {
      flags: { json: jsonFlag, from: currentName, to: newName },
    } = this.parse(BranchRename);

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
      )} on project ${chalk.bold(`@${accountName}/${exp.slug}`)}.`
    );
  }
}
