import { Flags } from '@oclif/core';
import chalk from 'chalk';
import Table from 'cli-table3';

import EasCommand from '../../commandUtils/EasCommand';
import { UpdateQuery } from '../../graphql/queries/UpdateQuery';
import Log from '../../log';
import { getExpoConfig } from '../../project/expoConfig';
import { findProjectRootAsync, getProjectIdAsync } from '../../project/projectUtils';
import { promptAsync } from '../../prompts';
import { UPDATE_COLUMNS, formatUpdate, getPlatformsForGroup } from '../../update/utils';
import groupBy from '../../utils/expodash/groupBy';
import formatFields from '../../utils/formatFields';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

export default class BranchView extends EasCommand {
  static description = 'view a branch';

  static args = [
    {
      name: 'name',
      required: false,
      description: 'Name of the branch to view',
    },
  ];

  static flags = {
    json: Flags.boolean({
      description: `return a json with the branch's ID name and recent update groups.`,
      default: false,
    }),
  };

  async runAsync(): Promise<void> {
    let {
      args: { name },
      flags: { json: jsonFlag },
    } = await this.parse(BranchView);
    if (jsonFlag) {
      enableJsonOutput();
    }

    const projectDir = await findProjectRootAsync();
    const exp = getExpoConfig(projectDir);
    const projectId = await getProjectIdAsync(exp);

    if (!name) {
      const validationMessage = 'Branch name may not be empty.';
      if (jsonFlag) {
        throw new Error(validationMessage);
      }
      ({ name } = await promptAsync({
        type: 'text',
        name: 'name',
        message: 'Please enter the name of the branch to view:',
        validate: value => (value ? true : validationMessage),
      }));
    }

    const { app } = await UpdateQuery.viewBranchAsync({
      appId: projectId,
      name,
    });
    const UpdateBranch = app?.byId.updateBranchByName;
    if (!UpdateBranch) {
      throw new Error(`Could not find branch "${name}"`);
    }

    const updates = Object.values(groupBy(UpdateBranch.updates, u => u.group)).map(
      group => group[0]
    );

    if (jsonFlag) {
      printJsonOnlyOutput({ ...UpdateBranch, updates });
    } else {
      const groupTable = new Table({
        head: UPDATE_COLUMNS,
        wordWrap: true,
      });

      for (const update of updates) {
        groupTable.push([
          formatUpdate(update),
          update.runtimeVersion,
          update.group,
          getPlatformsForGroup({
            updates: UpdateBranch.updates,
            group: update.group,
          }),
        ]);
      }

      Log.addNewLineIfNone();
      Log.log(chalk.bold('Branch:'));
      Log.log(
        formatFields([
          { label: 'Name', value: UpdateBranch.name },
          { label: 'ID', value: UpdateBranch.id },
        ])
      );
      Log.addNewLineIfNone();
      Log.log(chalk.bold('Recently published update groups:'));
      Log.log(groupTable.toString());
    }
  }
}
