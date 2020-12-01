import { getConfig } from '@expo/config';
import { Command, flags } from '@oclif/command';
import { cli } from 'cli-ux';
import dateformat from 'dateformat';
import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../../graphql/client';
import log from '../../log';
import { findProjectRootAsync, getProjectAccountNameAsync } from '../../project/projectUtils';

type UpdateRelease = {
  id: string;
  createdAt: string;
  platform: string;
  updateMessage: string;
  nativeRuntimeVersion: string;
  updateGroup: string;
  actor: {
    firstName: string;
  };
};

async function updateReleaseByReleaseNameAsync({
  fullName,
  releaseName,
}: {
  fullName: string;
  releaseName: string;
}): Promise<UpdateRelease[]> {
  const data = await withErrorHandlingAsync(
    graphqlClient
      // TODO: fix return type
      .query<any, { fullName: string; releaseName: string }>(
        gql`
          query UpdateReleaseByReleaseName($fullName: String!, $releaseName: String!) {
            app {
              byFullName(fullName: $fullName) {
                id
                updateReleases(offset: 0, limit: 10) {
                  id
                  releaseName
                }
                updateReleaseByReleaseName(releaseName: $releaseName) {
                  id
                  updates(offset: 0, limit: 100) {
                    id
                    platform
                    nativeRuntimeVersion
                    createdAt
                    updateMessage
                    updateGroup
                    actor {
                      firstName
                    }
                  }
                }
              }
            }
          }
        `,
        {
          fullName,
          releaseName,
        }
      )
      .toPromise()
  );
  return data.app.byFullName.updateReleaseByReleaseName.updates;
}

export default class UpdateList extends Command {
  static description = 'View a list of updates by release name.';

  static flags = {
    release: flags.string({
      description: 'Name of the release.',
    }),
    json: flags.boolean({
      description: 'Return list of updates as JSON.',
      default: false,
    }),
  };

  async run() {
    const {
      flags: { json, release },
    } = this.parse(UpdateList);

    if (!release) {
      throw new Error('A release name is required.');
    }

    const projectDir = await findProjectRootAsync(process.cwd());
    if (!projectDir) {
      throw new Error('Please run this command inside a project directory.');
    }
    const accountName = await getProjectAccountNameAsync(projectDir);
    const {
      exp: { slug },
    } = getConfig(projectDir, { skipSDKVersionRequirement: true });

    cli.action.start('Fetching updates');

    const updates = await updateReleaseByReleaseNameAsync({
      fullName: `@${accountName}/${slug}`,
      releaseName: release,
    });

    cli.action.stop();

    const result = updates.reduce(
      (acc, update) => {
        return {
          ...acc,
          [update.updateGroup]: {
            ...update,
            createdAt: dateformat(new Date(update.createdAt), 'yyyy-mm-dd HH:MM:ss'),
            platforms: [acc[update.updateGroup]?.platform, update.platform]
              .filter(Boolean)
              .sort()
              .join(', '),
          },
        };
      },
      {} as {
        [i: string]: UpdateRelease;
      }
    );

    if (json) {
      return log(Object.values(result));
    }

    cli.table(Object.values(result), {
      updateGroup: {
        header: 'ID',
        minWidth: 10,
        get: row => row.updateGroup.slice(0, 8),
      },
      createdAt: {
        header: 'Created At',
        minWidth: 21,
      },
      nativeRuntimeVersion: {
        header: 'RTV',
      },
      platforms: {},
      updateMessage: {
        header: 'Message',
        get: row => `[${row.actor.firstName}] ${row.updateMessage}`,
      },
    });
  }
}
