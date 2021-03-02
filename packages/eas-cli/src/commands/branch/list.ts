import { Command, flags } from '@oclif/command';
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
  UpdateBranch,
  User,
} from '../../graphql/generated';
import Log from '../../log';
import { findProjectRootAsync, getProjectFullNameAsync } from '../../project/projectUtils';
import { getActorDisplayName } from '../../user/actions';

const BRANCHES_LIMIT = 10_000;

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
    const fullName = await getProjectFullNameAsync(projectDir);
    const branches = await this.listBranchesAsync({ fullName });
    if (flags.json) {
      Log.log(JSON.stringify(branches, null, 2));
    } else {
      const table = new CliTable({ head: ['Branch', 'Latest update'] });
      table.push(...branches.map(branch => [branch.name, formatUpdate(branch.updates[0])]));
      Log.log(table.toString());
      if (branches.length >= BRANCHES_LIMIT) {
        Log.warn(`Showing first ${BRANCHES_LIMIT} branches, some results might be omitted.`);
      }
    }
  }

  async listBranchesAsync({
    fullName,
  }: {
    fullName: string;
  }): Promise<
    (Pick<UpdateBranch, 'id' | 'name'> & {
      updates: (Pick<Update, 'id' | 'updatedAt' | 'message'> & {
        actor?: Maybe<Pick<User, 'username' | 'id'> | Pick<Robot, 'firstName' | 'id'>>;
      })[];
    })[]
  > {
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
                      updatedAt
                      message
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
}

function formatUpdate(
  update: Pick<Update, 'id' | 'updatedAt' | 'message'> & {
    actor?: Maybe<Pick<User, 'username' | 'id'> | Pick<Robot, 'firstName' | 'id'>>;
  }
): string {
  if (!update) {
    return 'N/A';
  }
  const message = update.message ? `"${update.message}" ` : '';
  return `${message}(${format(update.updatedAt, 'en_US')} by ${getActorDisplayName(
    update.actor as any
  )})`;
}
