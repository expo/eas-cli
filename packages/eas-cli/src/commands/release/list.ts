import { Command, flags } from '@oclif/command';
import CliTable from 'cli-table3';
import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../../graphql/client';
import { RootQuery, UpdateRelease } from '../../graphql/generated';
import log from '../../log';
import { findProjectRootAsync, getProjectFullNameAsync } from '../../project/projectUtils';

async function listReleasesAsync({ fullName }: { fullName: string }): Promise<UpdateRelease[]> {
  const data = await withErrorHandlingAsync(
    graphqlClient
      .query<RootQuery>(
        gql`
          query ReleasesByAppQuery($fullName: String!) {
            app {
              byFullName(fullName: $fullName) {
                id
                fullName
                updateReleases(offset: 0, limit: 10000) {
                  id
                  releaseName
                  updates(offset: 0, limit: 1) {
                    id
                    updatedAt
                    actor {
                      ... on User {
                        firstName
                      }
                      ... on Robot {
                        firstName
                      }
                    }
                  }
                }
              }
            }
          }
        `,
        {
          fullName,
        }
      )
      .toPromise()
  );
  return data.app?.byFullName.updateReleases ?? [];
}

export default class ReleaseList extends Command {
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
    const releases = await listReleasesAsync({ fullName });
    if (flags.json) {
      log(JSON.stringify(releases, null, 2));
    } else {
      const table = new CliTable({ head: ['release', 'update', 'updated-at', 'user'] });
      table.push(
        ...releases.map((release: UpdateRelease) => [
          release.releaseName,
          release.updates[0]?.id,
          release.updates[0]?.updatedAt,
          release.updates[0]?.actor?.firstName,
        ])
      );
      log(table.toString());
    }
  }
}
