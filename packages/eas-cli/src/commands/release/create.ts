import { getConfig } from '@expo/config';
import { Command, flags } from '@oclif/command';
import chalk from 'chalk';
import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../../graphql/client';
import { UpdateRelease } from '../../graphql/generated';
import log from '../../log';
import { ensureProjectExistsAsync } from '../../project/ensureProjectExists';
import { findProjectRootAsync, getProjectAccountNameAsync } from '../../project/projectUtils';
import { promptAsync } from '../../prompts';
import { getBranchNameAsync } from '../../utils/git';

export async function createUpdateReleaseOnAppAsync({
  appId,
  releaseName,
}: {
  appId: string;
  releaseName: string;
}): Promise<Pick<UpdateRelease, 'id' | 'releaseName'>> {
  const data = await withErrorHandlingAsync(
    graphqlClient
      .mutation<
        { updateRelease: { createUpdateReleaseForApp: Pick<UpdateRelease, 'id' | 'releaseName'> } },
        { appId: string; releaseName: string }
      >(
        gql`
          mutation CreateUpdateReleaseForApp($appId: ID!, $releaseName: String!) {
            updateRelease {
              createUpdateReleaseForApp(appId: $appId, releaseName: $releaseName) {
                id
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
  static hidden = true;
  static description = 'Create a release on the current project.';

  static args = [
    {
      name: 'releaseName',
      required: false,
      description: 'Name of the release to create',
    },
  ];

  static flags = {
    json: flags.boolean({
      description: 'return a json with the new release ID and name.',
      default: false,
    }),
  };

  async run() {
    let {
      args: { releaseName },
      flags,
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
      const validationMessage = 'Release name may not be empty.';
      if (flags.json) {
        throw new Error(validationMessage);
      }
      ({ releaseName } = await promptAsync({
        type: 'text',
        name: 'releaseName',
        message: 'Please name the release:',
        initial:
          (await getBranchNameAsync()) || `release-${Math.random().toString(36).substr(2, 4)}`,
        validate: value => (value ? true : validationMessage),
      }));
    }

    const newRelease = await createUpdateReleaseOnAppAsync({ appId: projectId, releaseName });

    if (flags.json) {
      log(newRelease);
      return;
    }

    log.withTick(
      `️Created a new release: ${chalk.bold(newRelease.releaseName)} on project ${chalk.bold(
        `@${accountName}/${slug}`
      )}.`
    );
  }
}
