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

const BRANCHES_LIMIT = 10_000;

export async function listBranchesAsync({
  projectId,
}: {
  projectId: string;
}): Promise<UpdateBranchFragment[]> {
  const data = await withErrorHandlingAsync(
    graphqlClient
      .query<BranchesByAppQuery, BranchesByAppQueryVariables>(
        gql`
          query BranchesByAppQuery($appId: String!, $limit: Int!) {
            app {
              byId(appId: $appId) {
                id
                updateBranches(offset: 0, limit: $limit) {
                  id
                  ...UpdateBranchFragment
                }
              }
            }
          }
          ${print(UpdateBranchFragmentNode)}
        `,
        {
          appId: projectId,
          limit: BRANCHES_LIMIT,
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
    const branches = await listBranchesAsync({ projectId });
    if (flags.json) {
      printJsonOnlyOutput(branches);
    } else {
      const table = new CliTable({
        head: ['Branch', ...UPDATE_COLUMNS],
        wordWrap: true,
      });

      table.push(
        ...branches.map(branch => [
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
      Log.log(chalk.bold('Branches with their most recent update group:'));
      Log.log(table.toString());
      if (branches.length >= BRANCHES_LIMIT) {
        Log.warn(`Showing first ${BRANCHES_LIMIT} branches, some results might be omitted.`);
      }
    }
  }
}
