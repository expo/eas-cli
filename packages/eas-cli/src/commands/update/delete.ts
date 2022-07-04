import { Flags } from '@oclif/core';
import chalk from 'chalk';
import { gql } from 'graphql-tag';

import EasCommand from '../../commandUtils/EasCommand.js';
import { graphqlClient, withErrorHandlingAsync } from '../../graphql/client.js';
import {
  DeleteUpdateGroupMutation,
  UpdateMutationDeleteUpdateGroupArgs,
} from '../../graphql/generated.js';
import Log from '../../log.js';
import { confirmAsync } from '../../prompts.js';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json.js';

async function deleteUpdateGroupAsync({
  group,
}: {
  group: string;
}): Promise<DeleteUpdateGroupMutation> {
  return await withErrorHandlingAsync(
    graphqlClient
      .mutation<DeleteUpdateGroupMutation, UpdateMutationDeleteUpdateGroupArgs>(
        gql`
          mutation DeleteUpdateGroup($group: ID!) {
            update {
              deleteUpdateGroup(group: $group) {
                group
              }
            }
          }
        `,
        { group }
      )
      .toPromise()
  );
}

export default class UpdateDelete extends EasCommand {
  static description = 'delete all the updates in an update group';

  static args = [
    {
      name: 'groupId',
      required: true,
      description: 'The ID of an update group to delete.',
    },
  ];

  static flags = {
    json: Flags.boolean({
      description: `Return a json with the group ID of the deleted updates.`,
      default: false,
    }),
  };

  async runAsync(): Promise<void> {
    const {
      args: { groupId: group },
      flags: { json: jsonFlag },
    } = await this.parse(UpdateDelete);

    if (jsonFlag) {
      enableJsonOutput();
    } else {
      const shouldAbort = await confirmAsync({
        message:
          `🚨${chalk.red('CAUTION')}🚨\n\n` +
          `${chalk.yellow(`This will delete all of the updates in group "${group}".`)} ${chalk.red(
            'This is a permanent operation.'
          )}\n\n` +
          `If you want to revert to a previous publish, you should use 'update --republish' targeted at the last working update group instead.\n\n` +
          `An update group should only be deleted in an emergency like an accidental publish of a secret. In this case user 'update --republish' to revert to the last working update group first and then proceed with the deletion. Deleting an update group when it is the latest publish can lead to inconsistent cacheing behavior by clients.\n\n` +
          `Would you like to abort?`,
      });

      if (shouldAbort) {
        Log.log('Aborted.');
        return;
      }
    }

    await deleteUpdateGroupAsync({ group });

    if (jsonFlag) {
      printJsonOnlyOutput({ group });
    } else {
      Log.withTick(`Deleted update group ${group}`);
    }
  }
}
