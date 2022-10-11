import chalk from 'chalk';
import Table from 'cli-table3';

import EasCommand from '../../commandUtils/EasCommand';
import { EasJsonOnlyFlag } from '../../commandUtils/flags';
import { UpdateQuery } from '../../graphql/queries/UpdateQuery';
import Log from '../../log';
import { UPDATE_COLUMNS, getUpdateGroupDescriptions } from '../../update/utils';
import formatFields from '../../utils/formatFields';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

export default class UpdateView extends EasCommand {
  static override description = 'update group details';

  static override args = [
    {
      name: 'groupId',
      required: true,
      description: 'The ID of an update group.',
    },
  ];

  static override flags = {
    ...EasJsonOnlyFlag,
  };

  static override contextDefinition = {
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const {
      args: { groupId },
      flags: { json: jsonFlag },
    } = await this.parse(UpdateView);

    const {
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(UpdateView, { nonInteractive: true });

    if (jsonFlag) {
      enableJsonOutput();
    }

    const updatesByGroup = await UpdateQuery.viewUpdateGroupAsync(graphqlClient, { groupId });
    const [updateGroupDescription] = getUpdateGroupDescriptions([updatesByGroup]);

    if (jsonFlag) {
      printJsonOnlyOutput(updateGroupDescription);
    } else {
      const groupTable = new Table({
        head: [...UPDATE_COLUMNS],
        wordWrap: true,
      });

      Log.log(chalk.bold('Update group:'));
      Log.log(formatFields([{ label: 'ID', value: updateGroupDescription.group }]));
      groupTable.push([
        updateGroupDescription.message,
        updateGroupDescription.runtimeVersion,
        updateGroupDescription.group,
        updateGroupDescription.platforms,
      ]);
      Log.log(groupTable.toString());
    }
  }
}
