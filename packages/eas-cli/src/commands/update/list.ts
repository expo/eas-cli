import { getConfig } from '@expo/config';
import { Command, flags } from '@oclif/command';
import Table from 'cli-table3';
import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../../graphql/client';
import { Update, User } from '../../graphql/generated';
import log from '../../log';
import { ensureProjectExistsAsync } from '../../project/ensureProjectExists';
import { findProjectRootAsync, getProjectAccountNameAsync } from '../../project/projectUtils';
import { promptAsync } from '../../prompts';

type TruncatedUpdate = Pick<
  Update,
  'updateGroup' | 'updateMessage' | 'createdAt' | 'platform' | 'runtimeVersion' | 'id'
> & { platforms: string; actor: User };
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
                    id
                    updateGroup
                    updateMessage
                    createdAt
                    platform
                    runtimeVersion
                    actor {
                      ... on User {
                        username
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
  static hidden = true;
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
      description: 'Platform-specifc updates to return: ios, android, web.',
      default: 'all',
    }),
    all: flags.boolean({
      description: 'Return a list of all updates individually.',
      default: false,
    }),
    json: flags.boolean({
      description: 'Return list of updates as JSON.',
      default: false,
    }),
  };

  async getUpdates(options: {
    projectId: string;
    releaseName: string;
    platformFlag: string;
    allFlag: boolean;
  }) {
    const { projectId, releaseName, platformFlag, allFlag } = options;

    const UpdateRelease = await viewUpdateReleaseAsync({
      appId: projectId,
      releaseName,
    });

    const filteredUpdates = UpdateRelease.updates.filter(update => {
      if (!platformFlag) {
        return update;
      }

      return platformFlag.split(',').includes(update.platform);
    });

    if (allFlag) {
      return filteredUpdates;
    }

    const updatesByGroup = filteredUpdates.reduce(
      (acc, update) => ({
        ...acc,
        [update.updateGroup]: {
          ...update,
          platforms: [acc[update.updateGroup]?.platform, update.platform]
            .filter(Boolean)
            .sort()
            .join(', '),
        },
      }),
      {} as {
        [i: string]: TruncatedUpdate;
      }
    );

    return Object.values(updatesByGroup);
  }

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

    const updates = await this.getUpdates({
      projectId,
      releaseName,
      platformFlag,
      allFlag,
    });

    if (jsonFlag) {
      log(updates);
      return;
    }

    const updateGroupTable = new Table({
      head: [
        'Created at',
        'Update message',
        `${allFlag ? 'Update ID' : 'Update group ID'}`,
        `Platform${allFlag ? '' : 's'}`,
      ],
      wordWrap: true,
    });

    for (const update of updates) {
      updateGroupTable.push([
        new Date(update.createdAt).toLocaleString(),
        `[${update.actor?.username}] ${update.updateMessage}`,
        ...(allFlag ? [update.id] : [update.updateGroup]),
        ...(allFlag ? [update.platform] : [update.platforms]),
      ]);
    }

    log(updateGroupTable.toString());
  }
}
