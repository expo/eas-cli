import chalk from 'chalk';

import EasCommand from '../../commandUtils/EasCommand';
import { EasNonInteractiveAndJsonFlags } from '../../commandUtils/flags';
import Log from '../../log';
import { confirmAsync } from '../../prompts';
import { scheduleUpdateGroupDeletionAsync } from '../../update/delete';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';
import { pollForBackgroundJobReceiptAsync } from '../../utils/pollForBackgroundJobReceiptAsync';

export default class UpdateDelete extends EasCommand {
  static override description = 'delete all the updates in an update group';

  static override args = [
    {
      name: 'groupId',
      required: true,
      description: 'The ID of an update group to delete.',
    },
  ];

  static override flags = {
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const {
      args: { groupId: group },
      flags: { json: jsonFlag, 'non-interactive': nonInteractive },
    } = await this.parse(UpdateDelete);

    const {
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(UpdateDelete, { nonInteractive });

    if (jsonFlag) {
      enableJsonOutput();
    }

    if (!nonInteractive) {
      const shouldContinue = await confirmAsync({
        message:
          `🚨${chalk.red('CAUTION')}🚨\n\n` +
          `${chalk.yellow(`This will delete all of the updates in group "${group}".`)} ${chalk.red(
            'This is a permanent operation.'
          )}\n\n` +
          `If you want to revert to a previous publish, you should use 'update --republish' targeted at the last working update group instead.\n\n` +
          `An update group should only be deleted in an emergency like an accidental publish of a secret. In this case user 'update --republish' to revert to the last working update group first and then proceed with the deletion. Deleting an update group when it is the latest publish can lead to inconsistent caching behavior by clients.\n\n` +
          `Would you like to continue?`,
      });

      if (!shouldContinue) {
        Log.log('Aborted.');
        return;
      }
    }

    const receipt = await scheduleUpdateGroupDeletionAsync(graphqlClient, { group });
    const successfulReceipt = await pollForBackgroundJobReceiptAsync(graphqlClient, receipt);
    Log.debug('Deletion result', { successfulReceipt });

    if (jsonFlag) {
      printJsonOnlyOutput({ group });
    } else {
      Log.withTick(`Deleted update group ${group}`);
    }
  }
}
