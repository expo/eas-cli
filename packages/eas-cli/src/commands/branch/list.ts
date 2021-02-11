import { Command, flags } from '@oclif/command';
import { CLIError } from '@oclif/errors';
import CliTable from 'cli-table3';
import gql from 'graphql-tag';
import { format } from 'timeago.js';

import { graphqlClient } from '../../graphql/client';
import { RootQuery, Update, UpdateBranch } from '../../graphql/generated';
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
      table.push(
        ...branches.map((branch: UpdateBranch) => [
          branch.branchName,
          formatUpdate(branch.updates[0]),
        ])
      );
      Log.log(table.toString());
      if (branches.length >= BRANCHES_LIMIT) {
        Log.warn(`Showing first ${BRANCHES_LIMIT} branches, some results might be omitted.`);
      }
    }
  }

  async listBranchesAsync({ fullName }: { fullName: string }): Promise<UpdateBranch[]> {
    const { data, error } = await graphqlClient
      .query<RootQuery>(
        gql`
          query BranchesByAppQuery($fullName: String!, $limit: Int!) {
            app {
              byFullName(fullName: $fullName) {
                id
                fullName
                updateBranches(offset: 0, limit: $limit) {
                  id
                  branchName
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
                    updateMessage
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
      .toPromise();

    if (error) {
      if (error.networkError) {
        throw new CLIError(`Fetching branches failed: ${error.networkError.message}`);
      } else {
        throw new CLIError(error.graphQLErrors.map(e => e.message).join('\n'));
      }
    }

    return data?.app?.byFullName.updateBranches ?? [];
  }
}

function formatUpdate(update: Update | undefined): string {
  if (!update) {
    return 'N/A';
  }
  const message = update.updateMessage ? `"${update.updateMessage}" ` : '';
  return `${message}(${format(update.updatedAt, 'en_US')} by ${getActorDisplayName(
    update.actor as any
  )})`;
}
