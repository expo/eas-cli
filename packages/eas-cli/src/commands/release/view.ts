import { getConfig } from '@expo/config';
import { Command, flags } from '@oclif/command';
import chalk from 'chalk';
import Table from 'cli-table3';
import gql from 'graphql-tag';
import { groupBy } from 'lodash';

import { graphqlClient, withErrorHandlingAsync } from '../../graphql/client';
import { Update } from '../../graphql/generated';
import log from '../../log';
import { ensureProjectExistsAsync } from '../../project/ensureProjectExists';
import { findProjectRootAsync, getProjectAccountNameAsync } from '../../project/projectUtils';
import { promptAsync } from '../../prompts';

const PAGE_LIMIT = 10_000;

type TruncatedUpdate = Pick<Update, 'updateGroup' | 'updateMessage' | 'createdAt' | 'actor'>;

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

export default class ReleaseView extends Command {
  static hidden = true;
  static description = 'View a release.';

  static args = [
    {
      name: 'releaseName',
      required: false,
      description: 'Name of the release to view',
    },
  ];

  static flags = {
    json: flags.boolean({
      description: `return a json with the release's ID name and recent update groups.`,
      default: false,
    }),
  };

  async run() {
    let {
      args: { releaseName },
      flags: { json: jsonFlag },
    } = this.parse(ReleaseView);

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

    const updates = Object.values(groupBy(UpdateRelease.updates, u => u.updateGroup)).map(
      updateGroup => updateGroup[0]
    );

    if (jsonFlag) {
      log({ ...UpdateRelease, updates });
      return;
    }

    const updateGroupTable = new Table({
      head: ['createdAt', 'updateMessage', 'updateGroup', 'actor'],
      wordWrap: true,
    });

    for (const update of updates) {
      updateGroupTable.push([
        new Date(update.createdAt).toLocaleString(),
        update.updateMessage,
        update.updateGroup,
        update.actor?.firstName,
      ]);
    }

    log.withTick(
      `️Release: ${chalk.bold(UpdateRelease.releaseName)} on project ${chalk.bold(
        `@${accountName}/${slug}`
      )}. Release ID: ${chalk.bold(UpdateRelease.id)}`
    );
    log(chalk.bold('Recent update groups published on this release:'));
    log(updateGroupTable.toString());
  }
}
