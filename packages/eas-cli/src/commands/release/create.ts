import { getConfig } from '@expo/config';
import { Command, flags } from '@oclif/command';
import chalk from 'chalk';
import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../../graphql/client';
import log from '../../log';
import { ensureProjectExistsAsync } from '../../project/ensureProjectExists';
import { findProjectRootAsync, getProjectAccountNameAsync } from '../../project/projectUtils';
import { promptAsync } from '../../prompts';

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
      ({ releaseName } = await promptAsync({
        type: 'text',
        name: 'releaseName',
        message: 'Please name the release:',
        validate: value => (value ? true : 'Release name may not be empty.'),
      }));
    }

    const newRelease = await createUpdateReleaseOnAppAsync({ appId: projectId, releaseName });

    log.withTick(
      `️Created a new release: ${chalk.bold(newRelease.releaseName)} on project ${chalk.bold(
        `@${accountName}/${slug}`
      )}.`
    );
  }
}
