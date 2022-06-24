import { Flags } from '@oclif/core';
import chalk from 'chalk';
import CliTable from 'cli-table3';
import { print } from 'graphql';
import gql from 'graphql-tag';

import EasCommand from '../../commandUtils/EasCommand';
import { graphqlClient, withErrorHandlingAsync } from '../../graphql/client';
import {
  BranchesByAppQuery,
  BranchesByAppQueryVariables,
  UpdateBranchFragment,
} from '../../graphql/generated';
import { UpdateBranchFragmentNode } from '../../graphql/types/UpdateBranch';
import Log from '../../log';
import { getExpoConfig } from '../../project/expoConfig';
import { findProjectRootAsync, getProjectIdAsync } from '../../project/projectUtils';
import { UPDATE_COLUMNS, formatUpdate, getPlatformsForGroup } from '../../update/utils';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';
import { PaginatedQueryResponse, performPaginatedQueryAsync } from '../../utils/queries';

export const BRANCHES_LIMIT = 50;

export async function listBranchesAsync({
  appId,
  limit = BRANCHES_LIMIT,
  offset = 0,
}: BranchesByAppQueryVariables): Promise<UpdateBranchFragment[]> {
  const data = await withErrorHandlingAsync(
    graphqlClient
      .query<BranchesByAppQuery, BranchesByAppQueryVariables>(
        gql`
          query BranchesByAppQuery($appId: String!, $limit: Int!, $offset: Int!) {
            app {
              byId(appId: $appId) {
                id
                updateBranches(offset: $offset, limit: $limit) {
                  id
                  ...UpdateBranchFragment
                }
              }
            }
          }
          ${print(UpdateBranchFragmentNode)}
        `,
        {
          appId,
          limit,
          offset,
        },
        { additionalTypenames: ['UpdateBranch'] }
      )
      .toPromise()
  );

  return data?.app?.byId.updateBranches ?? [];
}

export default class BranchList extends EasCommand {
  static description = 'list all branches';

  static flags = {
    json: Flags.boolean({
      description: 'return output as JSON',
      default: false,
    }),
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(BranchList);
    if (flags.json) {
      enableJsonOutput();
    }

    const projectDir = await findProjectRootAsync();
    const exp = getExpoConfig(projectDir);
    const projectId = await getProjectIdAsync(exp);
    await queryForPaginatedBranchesAsync(projectId, flags);
  }
}

async function queryForPaginatedBranchesAsync(
  projectId: string,
  flags: { json: boolean } & { json: boolean | undefined }
): Promise<void> {
  const queryAdditionalBranchesAsync = async (
    pageSize: number,
    offset: number
  ): Promise<PaginatedQueryResponse<UpdateBranchFragment>> => {
    const branches = await listBranchesAsync({ appId: projectId, limit: pageSize, offset });
    return {
      queryResponse: branches,
      queryResponseRawLength: branches.length,
    };
  };

  const renderPageOfBranches = (currentPage: UpdateBranchFragment[]): void => {
    if (flags.json) {
      printJsonOnlyOutput(currentPage);
    } else {
      const table = new CliTable({
        head: ['Branch', ...UPDATE_COLUMNS],
        wordWrap: true,
      });

      table.push(
        ...currentPage.map(branch => [
          branch.name,
          formatUpdate(branch.updates[0]),
          branch.updates[0]?.runtimeVersion ?? 'N/A',
          branch.updates[0]?.group ?? 'N/A',
          getPlatformsForGroup({
            updates: branch.updates,
            group: branch.updates[0]?.group,
          }),
        ])
      );

      Log.addNewLineIfNone();
      Log.log(chalk.bold('Branches:'));
      Log.addNewLineIfNone();
      Log.log(table.toString());
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
