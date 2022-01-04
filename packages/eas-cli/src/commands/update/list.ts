import { getConfig } from '@expo/config';
import { Flags } from '@oclif/core';
import chalk from 'chalk';
import CliTable from 'cli-table3';

import EasCommand from '../../commandUtils/EasCommand';
import { ViewAllUpdatesQuery } from '../../graphql/generated';
import { UpdateQuery } from '../../graphql/queries/UpdateQuery';
import Log from '../../log';
import { findProjectRootAsync, getProjectIdAsync } from '../../project/projectUtils';
import { promptAsync } from '../../prompts';
import { FormatUpdateParameter, UPDATE_COLUMNS, formatUpdate } from '../../update/utils';
import groupBy from '../../utils/expodash/groupBy';
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
    let {
      flags: { branch, all, json: jsonFlag },
    } = await this.parse(BranchView);
    if (jsonFlag) {
      enableJsonOutput();
    }

    const projectDir = await findProjectRootAsync();
    const { exp } = getConfig(projectDir, { skipSDKVersionRequirement: true });
    const projectId = await getProjectIdAsync(exp);

    let updateGroupDescriptions: ReturnType<typeof getUpdateGroupDescriptions>;
    if (all) {
      const branchesAndUpdates = await UpdateQuery.viewAllUpdatesAsync({ appId: projectId });
      updateGroupDescriptions = getUpdateGroupDescriptions(
        branchesAndUpdates.app.byId.updateBranches
      );
    } else {
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
      updateGroupDescriptions = getUpdateGroupDescriptions([UpdateBranch]);
    }

    if (jsonFlag) {
      printJsonOnlyOutput(updateGroupDescriptions);
    } else {
      logOutput(updateGroupDescriptions);
    }
  }
}

function getUpdateGroupDescriptions(
  branchesAndUpdates: ViewAllUpdatesQuery['app']['byId']['updateBranches']
): (FormatUpdateParameter & {
  branch: string;
  group: string;
  platforms: string;
  runtimeVersion: string;
})[] {
  const flattenedBranchesAndUpdates = branchesAndUpdates.flatMap(branch =>
    branch.updates.map(update => {
      return { branch: branch.name, ...update };
    })
  );
  const updateGroupRepresentative = Object.values(
    groupBy(flattenedBranchesAndUpdates, u => u.group)
  ).map(group => {
    const platforms = group
      .map(u => u.platform)
      .sort()
      .join(', ');
    return { ...group[0], platforms };
  });
  updateGroupRepresentative.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  return updateGroupRepresentative;
}

function logOutput(updateGroupDescriptions: ReturnType<typeof getUpdateGroupDescriptions>): void {
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
