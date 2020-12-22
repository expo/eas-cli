import { Command, flags } from '@oclif/command';
import { CLIError } from '@oclif/errors';
import CliTable from 'cli-table3';
import gql from 'graphql-tag';
import { format } from 'timeago.js';

import { graphqlClient } from '../../graphql/client';
import { RootQuery, Update, UpdateRelease } from '../../graphql/generated';
import log from '../../log';
import { findProjectRootAsync, getProjectFullNameAsync } from '../../project/projectUtils';
import { getActorDisplayName } from '../../user/actions';

const RELEASES_LIMIT = 10_000;

export default class ReleaseList extends Command {
  static hidden = true;

  static description = 'List all releases on this project.';

  static flags = {
    json: flags.boolean({
      description: 'return output as JSON',
      default: false,
    }),
  };

  async run() {
    const { flags } = this.parse(ReleaseList);

    const projectDir = await findProjectRootAsync(process.cwd());
    if (!projectDir) {
      throw new Error('Please run this command inside a project directory.');
    }
    const fullName = await getProjectFullNameAsync(projectDir);
    const releases = await this.listReleasesAsync({ fullName });
    if (flags.json) {
      log(JSON.stringify(releases, null, 2));
    } else {
      const table = new CliTable({ head: ['Release', 'Latest update'] });
      table.push(
        ...releases.map((release: UpdateRelease) => [
          release.releaseName,
          formatUpdate(release.updates[0]),
        ])
      );
      log(table.toString());
      if (releases.length >= RELEASES_LIMIT) {
        log.warn(`Showing first ${RELEASES_LIMIT} releases, some results might be omitted.`);
      }
    }
  }

  async listReleasesAsync({ fullName }: { fullName: string }): Promise<UpdateRelease[]> {
    const { data, error } = await graphqlClient
      .query<RootQuery>(
        gql`
          query ReleasesByAppQuery($fullName: String!, $limit: Int!) {
            app {
              byFullName(fullName: $fullName) {
                id
                fullName
                updateReleases(offset: 0, limit: $limit) {
                  id
                  releaseName
                  updates(offset: 0, limit: 1) {
                    actor {
                      __typename
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
          limit: RELEASES_LIMIT,
        }
      )
      .toPromise();

    if (error) {
      if (error.networkError) {
        throw new CLIError(`Fetching releases failed: ${error.networkError.message}`);
      } else {
        throw new CLIError(error.graphQLErrors.map(e => e.message).join('\n'));
      }
    }

    return data?.app?.byFullName.updateReleases ?? [];
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
