import { Flags } from '@oclif/core';
import assert from 'assert';
import chalk from 'chalk';

import EasCommand from '../../commandUtils/EasCommand';
import { EasNonInteractiveAndJsonFlags } from '../../commandUtils/flags';
import { PublishMutation } from '../../graphql/mutations/PublishMutation';
import { UpdateQuery } from '../../graphql/queries/UpdateQuery';
import Log from '../../log';
import { promptAsync } from '../../prompts';
import {
  formatUpdateGroup,
  getUpdateGroupDescriptions,
  getUpdateJsonInfosForUpdates,
} from '../../update/utils';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

export default class UpdateEdit extends EasCommand {
  static override description = 'edit all the updates in an update group';
  static override hidden = true;

  static override args = [
    {
      name: 'groupId',
      required: true,
      description: 'The ID of an update group to edit.',
    },
  ];

  static override flags = {
    'rollout-percentage': Flags.integer({
      description: `Rollout percentage to set for a rollout update. The specified number must be an integer between 1 and 100.`,
      required: false,
      min: 0,
      max: 100,
    }),
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const {
      args: { groupId },
      flags: {
        'rollout-percentage': rolloutPercentage,
        json: jsonFlag,
        'non-interactive': nonInteractive,
      },
    } = await this.parse(UpdateEdit);

    const {
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(UpdateEdit, { nonInteractive });

    if (jsonFlag) {
      enableJsonOutput();
    }

    const proposedUpdatesToEdit = (
      await UpdateQuery.viewUpdateGroupAsync(graphqlClient, { groupId })
    ).map(u => ({ updateId: u.id, rolloutPercentage: u.rolloutPercentage }));

    const updatesToEdit = proposedUpdatesToEdit.filter(
      (u): u is { updateId: string; rolloutPercentage: number } =>
        u.rolloutPercentage !== null && u.rolloutPercentage !== undefined
    );

    if (updatesToEdit.length === 0) {
      throw new Error('Cannot edit rollout percentage on update group that is not a rollout.');
    }

    const rolloutPercentagesSet = new Set(updatesToEdit.map(u => u.rolloutPercentage));
    if (rolloutPercentagesSet.size !== 1) {
      throw new Error(
        'Cannot edit rollout percentage for a group with non-equal percentages for updates in the group.'
      );
    }

    const previousPercentage = updatesToEdit[0].rolloutPercentage;

    if (nonInteractive && rolloutPercentage === undefined) {
      throw new Error('Must specify --rollout-percentage in non-interactive mode');
    }

    let rolloutPercentageToSet = rolloutPercentage;
    if (rolloutPercentageToSet === undefined) {
      const { percentage } = await promptAsync({
        type: 'number',
        message: `New rollout percentage (min: ${previousPercentage}, max: 100)`,
        validate: value => {
          if (value <= previousPercentage) {
            return `Rollout percentage must be greater than previous rollout percentage (${previousPercentage})`;
          } else if (value > 100) {
            return `Rollout percentage must not be greater than 100`;
          } else {
            return true;
          }
        },
        name: 'percentage',
      });

      if (!percentage) {
        Log.log('Aborted .');
        return;
      }

      rolloutPercentageToSet = percentage;
    }

    assert(rolloutPercentageToSet !== undefined);

    if (rolloutPercentageToSet < previousPercentage) {
      throw new Error(
        `Rollout percentage must be greater than previous rollout percentage (${previousPercentage})`
      );
    } else if (rolloutPercentageToSet > 100) {
      throw new Error('Rollout percentage must not be greater than 100');
    }

    const updatedUpdates = await Promise.all(
      updatesToEdit.map(async u => {
        return await PublishMutation.setRolloutPercentageAsync(
          graphqlClient,
          u.updateId,
          rolloutPercentageToSet!
        );
      })
    );

    if (jsonFlag) {
      printJsonOnlyOutput(getUpdateJsonInfosForUpdates(updatedUpdates));
    } else {
      const [updateGroupDescription] = getUpdateGroupDescriptions([updatedUpdates]);

      Log.log(chalk.bold('Update group:'));

      Log.log(formatUpdateGroup(updateGroupDescription));
    }
  }
}
