import { Flags } from '@oclif/core';
import assert from 'assert';
import chalk from 'chalk';
import CliTable from 'cli-table3';

import EasCommand from '../../commandUtils/EasCommand';
import { ViewAllUpdatesQuery, ViewBranchUpdatesQuery } from '../../graphql/generated';
import { UpdateQuery } from '../../graphql/queries/UpdateQuery';
import Log from '../../log';
import { getExpoConfig } from '../../project/expoConfig';
import { findProjectRootAsync, getProjectIdAsync } from '../../project/projectUtils';
import { promptAsync } from '../../prompts';
import { FormatUpdateParameter, UPDATE_COLUMNS, formatUpdate } from '../../update/utils';
import groupBy from '../../utils/expodash/groupBy';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';
import { PaginatedQueryResponse, performPaginatedQueryAsync } from '../../utils/queries';
import { getVcsClient } from '../../vcs';

type UpdateGroupDescription = FormatUpdateParameter & {
  branch: string;
  group: string;
  platforms: string;
  runtimeVersion: string;
};

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

    if (all) {
      await fetchAllUpdatesForAppAsync(projectId, jsonFlag);
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

      fetchAllUpdatesForBranchAsync(projectId, branch, jsonFlag);
    }
  }
}

type BranchUpdateObject = Exclude<
  ViewBranchUpdatesQuery['app']['byId']['updateBranchByName'],
  null | undefined
>['updates'][0];
type AppUpdateObject = ViewAllUpdatesQuery['app']['byId']['updates'][0];

async function fetchAllUpdatesForBranchAsync(
  projectId: string,
  branchName: string,
  jsonFlag: boolean
): Promise<void> {
  const queryToPerformAsync = async (
    pageSize: number,
    offset: number
  ): Promise<PaginatedQueryResponse<BranchUpdateObject>> => {
    const branchesAndUpdates = await UpdateQuery.viewBranchAsync({
      appId: projectId,
      name: branchName,
      limit: pageSize,
      offset,
    });
    const UpdateBranch = branchesAndUpdates.app?.byId.updateBranchByName;
    if (!UpdateBranch) {
      throw new Error(`Could not find branch "${branchName}"`);
    }

    return {
      queryResponse: UpdateBranch.updates,
      queryResponseRawLength: UpdateBranch.updates.length,
    };
  };

  const renderListItems = (currentPage: BranchUpdateObject[]): void => {
    const updateGroupDescriptions = getUpdateGroupDescriptions(currentPage);

    if (jsonFlag) {
      printJsonOnlyOutput(updateGroupDescriptions);
    } else {
      logAsTable(updateGroupDescriptions);
    }
  };

  await performPaginatedQueryAsync({
    pageSize: 50,
    offset: 0,
    queryToPerform: queryToPerformAsync,
    promptOptions: {
      type: 'confirm',
      title: 'View next page of updates?',
      renderListItems,
    },
  });
}

async function fetchAllUpdatesForAppAsync(projectId: string, jsonFlag: boolean): Promise<void> {
  const queryToPerformAsync = async (
    pageSize: number,
    offset: number
  ): Promise<PaginatedQueryResponse<AppUpdateObject>> => {
    const viewAllUpdates = await UpdateQuery.viewAllAsync({
      appId: projectId,
      limit: pageSize,
      offset,
    });
    const { updates } = viewAllUpdates.app.byId;

    return {
      queryResponse: updates,
      queryResponseRawLength: updates.length,
    };
  };

  const renderListItems = (currentPage: AppUpdateObject[]): void => {
    const updateGroupDescriptions = getUpdateGroupDescriptions(currentPage);

    if (jsonFlag) {
      printJsonOnlyOutput(updateGroupDescriptions);
    } else {
      logAsTable(updateGroupDescriptions);
    }
  };

  await performPaginatedQueryAsync({
    pageSize: 50,
    offset: 0,
    queryToPerform: queryToPerformAsync,
    promptOptions: {
      type: 'confirm',
      title: 'View next page of updates?',
      renderListItems,
    },
  });
}

function getUpdateGroupDescriptions(
  updates: (BranchUpdateObject | AppUpdateObject)[]
): UpdateGroupDescription[] {
  return Object.values(groupBy(updates, update => update.group))
    .map(updateGroup => {
      return {
        platforms: updateGroup
          .map(update => update.platform)
          .sort()
          .join(', '),
        ...updateGroup[0],
        branch: updateGroup[0].branch.name,
      } as UpdateGroupDescription;
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
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
