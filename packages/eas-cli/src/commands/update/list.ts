import { getConfig } from '@expo/config';
import { Command, flags } from '@oclif/command';
import chalk from 'chalk';
import Table from 'cli-table3';
import { cli } from 'cli-ux';
import dateformat from 'dateformat';
import gql from 'graphql-tag';
import { groupBy } from 'lodash';

import { graphqlClient, withErrorHandlingAsync } from '../../graphql/client';
import { Update } from '../../graphql/generated';
import log from '../../log';
import { ensureProjectExistsAsync } from '../../project/ensureProjectExists';
import { findProjectRootAsync, getProjectAccountNameAsync } from '../../project/projectUtils';
import { promptAsync } from '../../prompts';

type TruncatedUpdate = Pick<
  Update,
  'updateGroup' | 'updateMessage' | 'createdAt' | 'actor' | 'platform' | 'nativeRuntimeVersion'
>;
const PAGE_LIMIT = 10_000;

async function viewUpdateReleaseAsync({
  appId,
  releaseName,
}: {
  appId: string;
  releaseName: string;
}): Promise<{
  id: string;
  releaseName: string;
  updates: TruncatedUpdate[];
}> {
  const data = await withErrorHandlingAsync(
    graphqlClient
      .mutation<
        {
          app: {
            byId: {
              updateReleaseByReleaseName: {
                id: string;
                releaseName: string;
                updates: TruncatedUpdate[];
              };
            };
          };
        },
        {
          appId: string;
          releaseName: string;
        }
      >(
        gql`
          query ViewRelease($appId: String!, $releaseName: String!) {
            app {
              byId(appId: $appId) {
                updateReleaseByReleaseName(releaseName: $releaseName) {
                  id
                  releaseName
                  updates(offset: 0, limit: ${PAGE_LIMIT}) {
                    updateGroup
                    updateMessage
                    createdAt
                    platform
                    nativeRuntimeVersion
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
          appId,
          releaseName,
        }
      )
      .toPromise()
  );
  return data.app.byId.updateReleaseByReleaseName;
}

export default class UpdateList extends Command {
  static description = 'View a list of updates.';

  static args = [
    {
      name: 'releaseName',
      required: false,
      description: 'Name of the release to view',
    },
  ];

  static flags = {
    platform: flags.string({
      description: 'Update platforms to return: ios, android, web.',
    }),
    json: flags.boolean({
      description: 'Return list of updates as JSON.',
      default: false,
    }),
    all: flags.boolean({
      description: 'Return a list of all updates individually.',
      default: false,
    }),
  };

  async run() {
    let {
      args: { releaseName },
      flags: { json: jsonFlag, platform: platformFlag, all: allFlag },
    } = this.parse(UpdateList);

    const projectDir = await findProjectRootAsync(process.cwd());
    if (!projectDir) {
      throw new Error('Please run this command inside a project directory.');
    }
    const accountName = await getProjectAccountNameAsync(projectDir);
    const {
      exp: { slug },
    } = getConfig(projectDir, { skipSDKVersionRequirement: true });
    const projectId = await ensureProjectExistsAsync({
      accountName,
      projectName: slug,
    });

    if (!releaseName) {
      const validationMessage = 'Release name may not be empty.';
      if (jsonFlag) {
        throw new Error(validationMessage);
      }
      ({ releaseName } = await promptAsync({
        type: 'text',
        name: 'releaseName',
        message: 'Please enter the name of the release to view:',
        validate: value => (value ? true : validationMessage),
      }));
    }

    const UpdateRelease = await viewUpdateReleaseAsync({
      appId: projectId,
      releaseName,
    });

    // const updates = Object.values(groupBy(UpdateRelease.updates, u => u.updateGroup)).map(
    //   updateGroup => updateGroup[0]
    // );

    const updates = UpdateRelease.updates.reduce(
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
        [i: string]: TruncatedUpdate;
      }
    );

    if (jsonFlag) {
      log({ ...UpdateRelease, updates });
      return;
    }

    // const updateGroupTable = new Table({
    //   head: ['Created At', 'Update Group', 'Update message'],
    //   wordWrap: true,
    // });

    // for (const update of updates) {
    //   updateGroupTable.push([
    //     new Date(update.createdAt).toLocaleString(),
    //     update.updateGroup,
    //     `[${update.actor?.firstName}] ${update.updateMessage}`,
    //   ]);
    // }

    log('');
    cli.table(
      Object.values(updates),
      {
        updateGroup: {
          header: 'ID',
          minWidth: 10,
          get: row => row.updateGroup.slice(0, 8),
        },
        createdAt: {
          header: 'Created At',
          minWidth: 24,
        },
        nativeRuntimeVersion: {
          header: 'RTV',
          minWidth: 10,
        },
        platforms: {
          minWidth: 15,
        },
        updateMessage: {
          header: 'Message',
          get: row => `[${row?.actor?.firstName}] ${row.updateMessage}`,
        },
      },
      {
        filter: platformFlag && `platforms=${platformFlag}`,
      }
    );

    // log.withTick(
    //   `️Release: ${chalk.bold(UpdateRelease.releaseName)} on project ${chalk.bold(
    //     `@${accountName}/${slug}`
    //   )}. Release ID: ${chalk.bold(UpdateRelease.id)}`
    // );
    // log(chalk.bold('Recent update groups published on this release:'));
    // log(updateGroupTable.toString());
  }
}
