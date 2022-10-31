import chalk from 'chalk';
import gql from 'graphql-tag';

import { createUpdateBranchOnAppAsync } from '../../branch/queries';
import { BranchNotFoundError } from '../../branch/utils';
import EasCommand from '../../commandUtils/EasCommand';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { EasNonInteractiveAndJsonFlags } from '../../commandUtils/flags';
import { withErrorHandlingAsync } from '../../graphql/client';
import {
  CreateUpdateChannelOnAppMutation,
  CreateUpdateChannelOnAppMutationVariables,
} from '../../graphql/generated';
import { BranchQuery } from '../../graphql/queries/BranchQuery';
import Log from '../../log';
import { getDisplayNameForProjectIdAsync } from '../../project/projectUtils';
import { promptAsync } from '../../prompts';
import formatFields from '../../utils/formatFields';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

// NOTE(cedric): copied to src/channel/queries.ts to reuse in multiple commands
export async function createUpdateChannelOnAppAsync(
  graphqlClient: ExpoGraphqlClient,
  {
    appId,
    channelName,
    branchId,
  }: {
    appId: string;
    channelName: string;
    branchId: string;
  }
): Promise<CreateUpdateChannelOnAppMutation> {
  // Point the new channel at a branch with its same name.
  const branchMapping = JSON.stringify({
    data: [{ branchId, branchMappingLogic: 'true' }],
    version: 0,
  });
  return await withErrorHandlingAsync(
    graphqlClient
      .mutation<CreateUpdateChannelOnAppMutation, CreateUpdateChannelOnAppMutationVariables>(
        gql`
          mutation CreateUpdateChannelOnApp($appId: ID!, $name: String!, $branchMapping: String!) {
            updateChannel {
              createUpdateChannelForApp(appId: $appId, name: $name, branchMapping: $branchMapping) {
                id
                name
                branchMapping
              }
            }
          }
        `,
        {
          appId,
          name: channelName,
          branchMapping,
        }
      )
      .toPromise()
  );
}

export default class ChannelCreate extends EasCommand {
  static override description = 'create a channel';

  static override args = [
    {
      name: 'name',
      required: false,
      description: 'Name of the channel to create',
    },
  ];

  static override flags = {
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectConfig,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    let {
      args: { name: channelName },
      flags: { json: jsonFlag, 'non-interactive': nonInteractive },
    } = await this.parse(ChannelCreate);
    const {
      projectConfig: { projectId },
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(ChannelCreate, {
      nonInteractive,
    });
    if (jsonFlag) {
      enableJsonOutput();
    }

    if (!channelName) {
      const validationMessage = 'Channel name may not be empty.';
      if (nonInteractive) {
        throw new Error(validationMessage);
      }
      ({ name: channelName } = await promptAsync({
        type: 'text',
        name: 'name',
        message: 'Provide a channel name:',
        validate: value => (value ? true : validationMessage),
      }));
    }

    let branchId: string;
    let branchMessage: string;

    try {
      const branch = await BranchQuery.getBranchByNameAsync(graphqlClient, {
        appId: projectId,
        name: channelName,
      });
      branchId = branch.id;
      branchMessage = `We found a branch with the same name`;
    } catch (error) {
      if (error instanceof BranchNotFoundError) {
        const newBranch = await createUpdateBranchOnAppAsync(graphqlClient, {
          appId: projectId,
          name: channelName,
        });
        branchId = newBranch.id;
        branchMessage = `We also went ahead and made a branch with the same name`;
      } else {
        throw error;
      }
    }

    const {
      updateChannel: { createUpdateChannelForApp: newChannel },
    } = await createUpdateChannelOnAppAsync(graphqlClient, {
      appId: projectId,
      channelName,
      branchId,
    });

    if (!newChannel) {
      throw new Error(
        `Could not create channel with name ${channelName} on project with id ${projectId}`
      );
    }

    if (jsonFlag) {
      printJsonOnlyOutput(newChannel);
    } else {
      Log.addNewLineIfNone();
      Log.withTick(
        `Created a new channel on project ${chalk.bold(
          await getDisplayNameForProjectIdAsync(graphqlClient, projectId)
        )}`
      );
      Log.log(
        formatFields([
          { label: 'Name', value: newChannel.name },
          { label: 'ID', value: newChannel.id },
        ])
      );
      Log.addNewLineIfNone();
      Log.withTick(`${branchMessage} and have pointed the channel at it.`);
      Log.log(
        formatFields([
          { label: 'Name', value: newChannel.name },
          { label: 'ID', value: branchId },
        ])
      );

      Log.addNewLineIfNone();
      Log.log(chalk.bold('You can now update your app by publishing!'));
    }
  }
}
