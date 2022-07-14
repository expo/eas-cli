import { Flags } from '@oclif/core';
import assert from 'assert';
import chalk from 'chalk';
import CliTable from 'cli-table3';

import EasCommand from '../../commandUtils/EasCommand';
import { UpdateQuery } from '../../graphql/queries/UpdateQuery';
import Log from '../../log';
import { getExpoConfig } from '../../project/expoConfig';
import { findProjectRootAsync, getProjectIdAsync } from '../../project/projectUtils';
import { promptAsync } from '../../prompts';
import { UPDATES_LIMIT } from '../../update/queries';
import {
  UPDATE_COLUMNS,
  UpdateGroupDescription,
  formatUpdate,
  getUpdateGroupsWithPlatforms,
} from '../../update/utils';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';
import { getVcsClient } from '../../vcs';

export default class BranchView extends EasCommand {
  static description = 'view the recent updates for a branch';

  static flags = {
    branch: Flags.string({
      description: 'List all updates on this branch',
      exclusive: ['all'],
    }),
    all: Flags.boolean({
      description: 'List all updates associated with this project',
      exclusive: ['branch'],
      default: false,
    }),
    json: Flags.boolean({
      description: `Return a json with all of the recent update groups.`,
      default: false,
    }),
  };

  async runAsync(): Promise<void> {
    const {
      flags: { branch: branchFlag, all, json: jsonFlag },
    } = await this.parse(BranchView);
    if (jsonFlag) {
      enableJsonOutput();
    }

    const projectDir = await findProjectRootAsync();
    const exp = getExpoConfig(projectDir);
    const projectId = await getProjectIdAsync(exp);

    let updateGroupDescriptions: UpdateGroupDescription[];
    if (all) {
      const branchesAndUpdates = await UpdateQuery.viewAllAsync({
        appId: projectId,
        limit: UPDATES_LIMIT,
        offset: 0,
      });
      updateGroupDescriptions = getUpdateGroupsWithPlatforms(
        branchesAndUpdates.app.byId.updates.map(update => ({
          ...update,
          branch: update.branch.name,
        }))
      ).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    } else {
      let branchInteractive: string | undefined;
      if (!branchFlag) {
        const validationMessage = 'Branch name may not be empty.';
        if (jsonFlag) {
          throw new Error(validationMessage);
        }
        ({ name: branchInteractive } = await promptAsync({
          type: 'text',
          name: 'name',
          message: 'Please enter the name of the branch whose updates you wish to view:',
          initial: (await getVcsClient().getBranchNameAsync()) ?? undefined,
          validate: (value: any) => (value ? true : validationMessage),
        }));
      }
      const branch = branchFlag ?? branchInteractive;
      assert(branch, 'Branch name may not be empty.');

      const branchesAndUpdates = await UpdateQuery.viewBranchAsync({
        appId: projectId,
        name: branch,
        limit: UPDATES_LIMIT,
        offset: 0,
      });
      const UpdateBranch = branchesAndUpdates.app?.byId.updateBranchByName;
      if (!UpdateBranch) {
        throw new Error(`Could not find branch "${branch}"`);
      }
      updateGroupDescriptions = getUpdateGroupsWithPlatforms(
        UpdateBranch.updates.map(update => ({ ...update, branch }))
      ).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }

    if (jsonFlag) {
      printJsonOnlyOutput(updateGroupDescriptions);
    } else {
      logAsTable(updateGroupDescriptions);
    }
  }
}

function logAsTable(updateGroupDescriptions: UpdateGroupDescription[]): void {
  const table = new CliTable({
    head: ['Branch', ...UPDATE_COLUMNS],
    wordWrap: true,
  });
  table.push(
    ...updateGroupDescriptions.map(updateGroupDescription => [
      updateGroupDescription.branch,
      formatUpdate(updateGroupDescription),
      updateGroupDescription.runtimeVersion,
      updateGroupDescription.group,
      updateGroupDescription.platforms,
    ])
  );
  Log.addNewLineIfNone();
  Log.log(chalk.bold('Recently published update groups:'));
  Log.log(table.toString());
}
