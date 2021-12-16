import { flags } from '@oclif/command';
import chalk from 'chalk';
import gql from 'graphql-tag';

import EasCommand from '../../commandUtils/EasCommand';
import { graphqlClient, withErrorHandlingAsync } from '../../graphql/client';
import {
  DeleteUpdateGroupMutation,
  UpdateMutationDeleteUpdateGroupArgs,
} from '../../graphql/generated';
import Log from '../../log';
import { confirmAsync } from '../../prompts';

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
  static description = 'Delete all the updates in an update Group.';

  static args = [
    {
      name: 'groupId',
      required: true,
      description: 'The ID of an update group to delete.',
    },
  ];

  static flags = {
    json: flags.boolean({
      description: `Return a json with the group ID of the deleted updates.`,
      default: false,
    }),
  };

  async runAsync(): Promise<void> {
    const {
      args: { groupId: group },
      flags: { json: jsonFlag },
    } = this.parse(UpdateDelete);

    if (!jsonFlag) {
      const shouldAbort = await confirmAsync({
        message:
          `🚨${chalk.red('CAUTION')}🚨\n\n` +
          `${chalk.yellow(`This will delete all of the updates in group "${group}".`)} ${chalk.red(
            'This is a permanent operation.'
          )}\n\n` +
          `If you want to revert to a previous publish, you should use 'branch:publish --republish' targeted at the last working update group instead.\n\n` +
          `An update group should only be deleted in an emergency like an accidental publish of a secret. In this case user 'branch:publish --republish' to revert to the last working update group first and then proceed with the deletion. Deleting an update group when it is the latest publish can lead to inconsistent cacheing behavior by clients.\n\n` +
          `Would you like to abort?`,
      });

      if (shouldAbort) {
        Log.log('Aborted.');
        return;
      }
    }

    await deleteUpdateGroupAsync({ group });

    if (jsonFlag) {
      Log.log(JSON.stringify({ group }));
      return;
    }

    Log.withTick(`Deleted update group ${group}`);
  }
}
