import { getConfig } from '@expo/config';
import { Command, flags } from '@oclif/command';
import chalk from 'chalk';
import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../../graphql/client';
import { UpdateChannel } from '../../graphql/generated';
import log from '../../log';
import { ensureProjectExistsAsync } from '../../project/ensureProjectExists';
import {
  findProjectRootAsync,
  getProjectAccountNameAsync,
  getReleaseByNameAsync,
} from '../../project/projectUtils';
import { promptAsync } from '../../prompts';
import { createUpdateReleaseOnAppAsync } from '../release/create';

async function createUpdateChannelOnAppAsync({
  appId,
  channelName,
  releaseId,
}: {
  appId: string;
  channelName: string;
  releaseId: string;
}): Promise<UpdateChannel> {
  // Point the new channel at a release with its same name.
  const releaseMapping = JSON.stringify({
    data: [{ releaseId, releaseMappingLogic: 'true' }],
    version: 0,
  });
  const data = await withErrorHandlingAsync(
    graphqlClient
      .mutation<
        { updateChannel: { createUpdateChannelForApp: UpdateChannel } },
        { appId: string; channelName: string; releaseMapping: string }
      >(
        gql`
          mutation CreateUpdateChannelForApp(
            $appId: ID!
            $channelName: String!
            $releaseMapping: String!
          ) {
            updateChannel {
              createUpdateChannelForApp(
                appId: $appId
                channelName: $channelName
                releaseMapping: $releaseMapping
              ) {
                id
                channelName
                releaseMapping
              }
            }
          }
        `,
        {
          appId,
          channelName,
          releaseMapping,
        }
      )
      .toPromise()
  );
  return data.updateChannel.createUpdateChannelForApp;
}

export default class ChannelCreate extends Command {
  static hidden = true;
  static description = 'Create a channel on the current project.';

  static args = [
    {
      name: 'channelName',
      required: false,
      description: 'Name of the channel to create',
    },
  ];

  static flags = {
    json: flags.boolean({
      description:
        'print output as a JSON object with the new channel ID, name and release mapping.',
      default: false,
    }),
  };

  async run() {
    let {
      args: { channelName },
      flags: { json: jsonFlag },
    } = this.parse(ChannelCreate);

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

    if (!channelName) {
      const validationMessage = 'Channel name may not be empty.';
      if (jsonFlag) {
        throw new Error(validationMessage);
      }
      ({ channelName } = await promptAsync({
        type: 'text',
        name: 'channelName',
        message: 'Please name the channel:',
        validate: value => (value ? true : validationMessage),
      }));
    }

    let releaseId: string;
    let releaseMessage: string;
    try {
      const existingRelease = await getReleaseByNameAsync({
        appId: projectId,
        releaseName: channelName,
      });
      releaseId = existingRelease.id;
      releaseMessage = `We found a release with the same name`;
    } catch (e) {
      const newRelease = await createUpdateReleaseOnAppAsync({
        appId: projectId,
        releaseName: channelName,
      });
      releaseId = newRelease.id;
      releaseMessage = `We also went ahead and made a release with the same name`;
    }

    const newChannel = await createUpdateChannelOnAppAsync({
      appId: projectId,
      channelName,
      releaseId,
    });

    if (jsonFlag) {
      log(newChannel);
      return;
    }

    log.withTick(
      `️Created a new channel ${chalk.bold(newChannel.channelName)} on project ${chalk.bold(
        `@${accountName}/${slug}`
      )}. ${releaseMessage} and have pointed the channel at it. You can now update your app by publishing!`
    );
  }
}
