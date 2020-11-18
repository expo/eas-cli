import { Command, flags } from '@oclif/command';
import chalk from 'chalk';
import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../../graphql/client';
import log from '../../log';
import { findProjectRootAsync } from '../../project/projectUtils';
import { promptAsync } from '../../prompts';
import { getProjectIdAsync } from '../../submissions/commons';

type UpdateRelease = {
  id: string;
  releaseName: string;
};

async function createUpdateReleaseOnAppAsync({
  appId,
  releaseName,
}: {
  appId: string;
  releaseName: string;
}): Promise<UpdateRelease> {
  const data = await withErrorHandlingAsync(
    graphqlClient
      .mutation<
        { updateRelease: { createUpdateReleaseForApp: UpdateRelease } },
        { appId: string; releaseName: string }
      >(
        gql`
          mutation CreateUpdateReleaseForApp($appId: ID!, $releaseName: String!) {
            updateRelease {
              createUpdateReleaseForApp(appId: $appId, releaseName: $releaseName) {
                releaseName
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
  return data.updateRelease.createUpdateReleaseForApp;
}

export default class ReleaseCreate extends Command {
  static description = 'Create a release on the current project.';

  static args = [
    {
      name: 'releaseName',
      required: false,
      description: 'Name of the release to create',
    },
  ];

  async run() {
    let {
      args: { releaseName },
    } = this.parse(ReleaseCreate);

    const projectDir = await findProjectRootAsync(process.cwd());
    if (!projectDir) {
      log.error("Please run this command inside a project directory.");
      return;
    }
    const projectId = await getProjectIdAsync(projectDir);

    if (!releaseName) {
      const userInput = await promptAsync({
        type: 'text',
        name: 'releaseName',
        message: 'Please name the release:',
      });
      releaseName = userInput.releaseName;
    }
    if (!releaseName) {
      log.error('You must specify a releaseName.');
      return;
    }

    try {
      const newRelease = await createUpdateReleaseOnAppAsync({ appId: projectId, releaseName });

      log.withTick(
        `️Created a new release: ${chalk.bold(
          newRelease.releaseName
        )} on project with id ${chalk.bold(projectId)}.`
      );
    } catch (e) {
      log.error(e);
    }
  }
}
