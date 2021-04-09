import { getConfig } from '@expo/config';
import { Command, flags } from '@oclif/command';
import chalk from 'chalk';
import CliTable from 'cli-table3';
import gql from 'graphql-tag';
import { format } from 'timeago.js';

import { graphqlClient, withErrorHandlingAsync } from '../../graphql/client';
import {
  BranchesByAppQuery,
  BranchesByAppQueryVariables,
  Maybe,
  Robot,
  Update,
  User,
} from '../../graphql/generated';
import Log from '../../log';
import { findProjectRootAsync, getProjectFullNameAsync } from '../../project/projectUtils';
import { getActorDisplayName } from '../../user/User';

export const UPDATE_COLUMNS = ['update description', 'update runtime version', 'update group ID'];
const BRANCHES_LIMIT = 10_000;

export async function listBranchesAsync({ fullName }: { fullName: string }) {
  const data = await withErrorHandlingAsync(
    graphqlClient
      .query<BranchesByAppQuery, BranchesByAppQueryVariables>(
        gql`
          query BranchesByAppQuery($fullName: String!, $limit: Int!) {
            app {
              byFullName(fullName: $fullName) {
                id
                fullName
                updateBranches(offset: 0, limit: $limit) {
                  id
                  name
                  updates(offset: 0, limit: 1) {
                    id
                    actor {
                      __typename
                      id
                      ... on User {
                        username
                      }
                      ... on Robot {
                        firstName
                      }
                    }
                    createdAt
                    message
                    runtimeVersion
                    group
                  }
                }
              }
            }
          }
        `,
        {
          fullName,
          limit: BRANCHES_LIMIT,
        }
      )
      .toPromise()
  );

  return data?.app?.byFullName.updateBranches ?? [];
}

export default class BranchList extends Command {
  static hidden = true;

  static description = 'List all branches on this project.';

  static flags = {
    json: flags.boolean({
      description: 'return output as JSON',
      default: false,
    }),
  };

  async run() {
    const { flags } = this.parse(BranchList);

    const projectDir = await findProjectRootAsync(process.cwd());
    if (!projectDir) {
      throw new Error('Please run this command inside a project directory.');
    }
    const { exp } = getConfig(projectDir, { skipSDKVersionRequirement: true });
    const fullName = await getProjectFullNameAsync(exp);
    const branches = await listBranchesAsync({ fullName });
    if (flags.json) {
      Log.log(JSON.stringify(branches, null, 2));
    } else {
      const table = new CliTable({
        head: ['branch', ...UPDATE_COLUMNS],
        wordWrap: true,
      });
      table.push(
        ...branches.map(branch => [
          branch.name,
          formatUpdate(branch.updates[0]),
          branch.updates[0].runtimeVersion,
          branch.updates[0].group,
        ])
      );
      Log.log(chalk.bold('Branches with their most recent update group:'));
      Log.log(table.toString());
      if (branches.length >= BRANCHES_LIMIT) {
        Log.warn(`Showing first ${BRANCHES_LIMIT} branches, some results might be omitted.`);
      }
    }
  }
}

export function formatUpdate(
  update: Pick<Update, 'id' | 'createdAt' | 'message'> & {
    actor?: Maybe<Pick<User, 'username' | 'id'> | Pick<Robot, 'firstName' | 'id'>>;
  }
): string {
  if (!update) {
    return 'N/A';
  }
  const message = update.message ? `"${update.message}" ` : '';
  return `${message}(${format(update.createdAt, 'en_US')} by ${getActorDisplayName(
    update.actor as any
  )})`;
}
