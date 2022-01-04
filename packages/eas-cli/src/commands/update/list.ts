import { getConfig } from '@expo/config';
import { Flags } from '@oclif/core';
import chalk from 'chalk';
import CliTable from 'cli-table3';
import Table from 'cli-table3';

import EasCommand from '../../commandUtils/EasCommand';
import { UpdateQuery } from '../../graphql/queries/UpdateQuery';
import Log from '../../log';
import { findProjectRootAsync, getProjectIdAsync } from '../../project/projectUtils';
import { promptAsync } from '../../prompts';
import { UPDATE_COLUMNS, formatUpdate, getPlatformsForGroup } from '../../update/utils';
import groupBy from '../../utils/expodash/groupBy';
import formatFields from '../../utils/formatFields';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';
import { getVcsClient } from '../../vcs';

export default class BranchView extends EasCommand {
  static description = 'View the recent updates for a branch';

  static flags = {
    branch: Flags.string({
      description: 'List all updates on this branch',
      exclusive: ['all'],
    }),
    all: Flags.boolean({
      description: `List all updates associated with this project.`,
      exclusive: ['branch'],
      default: false,
    }),
    json: Flags.boolean({
      description: `return a json with the branch's ID name and recent update groups.`,
      default: false,
    }),
  };

  async runAsync(): Promise<void> {
    let {
      flags: { branch, all, json: jsonFlag },
    } = await this.parse(BranchView);
    if (jsonFlag) {
      enableJsonOutput();
    }

    const projectDir = await findProjectRootAsync();
    const { exp } = getConfig(projectDir, { skipSDKVersionRequirement: true });
    const projectId = await getProjectIdAsync(exp);
    if (all) {
      const updatesAll = await UpdateQuery.viewAllUpdatesAsync({ appId: projectId });
      const parsedUpdates = [];
      for (const branch of updatesAll.app.byId.updateBranches) {
        for (const update of branch.updates) {
          parsedUpdates.push({
            branch: branch.name,
            ...update,
          });
        }
      }

      const groupedUpdates = groupBy(parsedUpdates, u => u.group);
      const updateGroups = Object.values(groupedUpdates).map(group => {
        const platforms = group
          .map(u => u.platform)
          .sort()
          .join(', ');
        return { ...group[0], platforms };
      });
      updateGroups.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );

      const table = new CliTable({
        head: ['Branch', ...UPDATE_COLUMNS],
        wordWrap: true,
      });
      table.push(
        ...updateGroups.map((update: any) => [
          update.branch,
          formatUpdate(update),
          update.runtimeVersion ?? 'N/A',
          update.group ?? 'N/A',
          update.platforms,
        ])
      );
      console.log(table.toString());
      process.exit();
      return;
    }

    if (!branch) {
      const validationMessage = 'Branch name may not be empty.';
      if (jsonFlag) {
        throw new Error(validationMessage);
      }
      ({ name: branch } = await promptAsync({
        type: 'text',
        name: 'name',
        message: 'Please enter the name of the branch to view:',
        initial: (await getVcsClient().getBranchNameAsync()) ?? undefined,
        validate: (value: any) => (value ? true : validationMessage),
      }));
    }

    const { app } = await UpdateQuery.viewUpdateBranchAsync({
      appId: projectId,
      name: branch!,
    });
    const UpdateBranch = app?.byId.updateBranchByName;
    if (!UpdateBranch) {
      throw new Error(`Could not find branch "${branch}"`);
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
