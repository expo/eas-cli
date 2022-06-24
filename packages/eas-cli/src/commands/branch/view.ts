import { Flags } from '@oclif/core';
import chalk from 'chalk';
import Table from 'cli-table3';

import EasCommand from '../../commandUtils/EasCommand';
import { ViewBranchUpdatesQuery } from '../../graphql/generated';
import { UpdateQuery } from '../../graphql/queries/UpdateQuery';
import Log from '../../log';
import { getExpoConfig } from '../../project/expoConfig';
import { findProjectRootAsync, getProjectIdAsync } from '../../project/projectUtils';
import { promptAsync } from '../../prompts';
import { UPDATE_COLUMNS, formatUpdate, getPlatformsForGroup } from '../../update/utils';
import groupBy from '../../utils/expodash/groupBy';
import formatFields from '../../utils/formatFields';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';
import { PaginatedQueryResponse, performPaginatedQueryAsync } from '../../utils/queries';

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

    await queryForPaginatedBranchesAsync(projectId, name, { json: jsonFlag });
  }
}

type BranchUpdateObject = Exclude<
  ViewBranchUpdatesQuery['app']['byId']['updateBranchByName'],
  null | undefined
>['updates'][0];

async function queryForPaginatedBranchesAsync(
  projectId: string,
  name: string,
  flags: { json: boolean } & { json: boolean | undefined }
): Promise<void> {
  const queryAdditionalBranchesAsync = async (
    pageSize: number,
    offset: number
  ): Promise<PaginatedQueryResponse<BranchUpdateObject>> => {
    const { app } = await UpdateQuery.viewBranchAsync({
      appId: projectId,
      name,
      limit: pageSize,
      offset,
    });
    const UpdateBranch = app?.byId.updateBranchByName;
    if (!UpdateBranch) {
      throw new Error(`Could not find branch "${name}"`);
    }

    const updateGroups = Object.values(groupBy(UpdateBranch.updates, u => u.group)).map(
      updateGroup => ({
        ...updateGroup[0],
        platform: getPlatformsForGroup({
          updates: updateGroup,
          group: updateGroup[0].group,
        }),
      })
    );

    return {
      queryResponse: updateGroups,
      queryResponseRawLength: UpdateBranch.updates.length,
    };
  };

  const renderPageOfBranches = (currentPage: BranchUpdateObject[]): void => {
    if (flags.json) {
      printJsonOnlyOutput(currentPage);
    } else {
      if (flags.json) {
        printJsonOnlyOutput({ currentPage });
      } else {
        const groupTable = new Table({
          head: UPDATE_COLUMNS,
          wordWrap: true,
        });

        for (const update of currentPage) {
          groupTable.push([
            formatUpdate(update),
            update.runtimeVersion,
            update.group,
            getPlatformsForGroup({
              updates: currentPage,
              group: update.group,
            }),
          ]);
        }

        Log.addNewLineIfNone();
        Log.log(chalk.bold('Branch:'));
        Log.log(
          formatFields([
            { label: 'Name', value: currentPage[0]['branch']['name'] },
            { label: 'ID', value: currentPage[0]['branch']['id'] },
          ])
        );
        Log.addNewLineIfNone();
        Log.log(groupTable.toString());
      }
    }
  };

  await performPaginatedQueryAsync({
    pageSize: 50,
    offset: 0,
    queryToPerform: queryAdditionalBranchesAsync,
    promptOptions: {
      type: 'confirm',
      title: 'Fetch next page of branches?',
      renderListItems: renderPageOfBranches,
    },
  });
}
