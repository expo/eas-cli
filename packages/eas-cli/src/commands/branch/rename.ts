import { Flags } from '@oclif/core';
import chalk from 'chalk';
import gql from 'graphql-tag';

import EasCommand from '../../commandUtils/EasCommand';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { EasNonInteractiveAndJsonFlags } from '../../commandUtils/flags';
import { withErrorHandlingAsync } from '../../graphql/client';
import {
  EditUpdateBranchInput,
  EditUpdateBranchMutation,
  EditUpdateBranchMutationVariables,
  UpdateBranch,
} from '../../graphql/generated';
import Log from '../../log';
import { getDisplayNameForProjectIdAsync } from '../../project/projectUtils';
import { promptAsync } from '../../prompts';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

async function renameUpdateBranchOnAppAsync(
  graphqlClient: ExpoGraphqlClient,
  { appId, name, newName }: EditUpdateBranchInput
): Promise<Pick<UpdateBranch, 'id' | 'name'>> {
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
  static override description = 'rename a branch';

  static override flags = {
    from: Flags.string({
      description: 'current name of the branch.',
      required: false,
    }),
    to: Flags.string({
      description: 'new name of the branch.',
      required: false,
    }),
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectId,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    let {
      flags: { json: jsonFlag, from: currentName, to: newName, 'non-interactive': nonInteractive },
    } = await this.parse(BranchRename);
    const {
      projectId,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(BranchRename, {
      nonInteractive,
    });
    if (jsonFlag) {
      enableJsonOutput();
    }

    const projectDisplayName = await getDisplayNameForProjectIdAsync(graphqlClient, projectId);

    if (!currentName) {
      const validationMessage = 'current name may not be empty.';
      if (nonInteractive) {
        throw new Error(validationMessage);
      }
      ({ currentName } = await promptAsync({
        type: 'text',
        name: 'currentName',
        message: "Provide the name of the branch you'd like to rename:",
        validate: value => (value ? true : validationMessage),
      }));
    }

    if (!newName) {
      const validationMessage = 'new name may not be empty.';
      if (nonInteractive) {
        throw new Error(validationMessage);
      }
      ({ newName } = await promptAsync({
        type: 'text',
        name: 'newName',
        message: `Rename ${currentName}`,
        validate: value => (value ? true : validationMessage),
      }));
    }

    const editedBranch = await renameUpdateBranchOnAppAsync(graphqlClient, {
      appId: projectId,
      name: currentName!,
      newName: newName!,
    });

    if (jsonFlag) {
      printJsonOnlyOutput(editedBranch);
    } else {
      Log.withTick(
        `️Renamed branch from ${currentName} to ${chalk.bold(
          editedBranch.name
        )} on project ${chalk.bold(projectDisplayName)}.`
      );
    }
  }
}
