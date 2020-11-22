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

async function editUpdateReleaseOnAppAsync({
  appId,
  releaseName,
  newReleaseName,
}: {
  appId: string;
  releaseName: string;
  newReleaseName: string;
}): Promise<UpdateRelease> {
  const data = await withErrorHandlingAsync(
    graphqlClient
      .mutation<
        { updateRelease: { editUpdateRelease: UpdateRelease } },
        {
          input: {
            appId: string;
            releaseName: string;
            newReleaseName: string;
          };
        }
      >(
        gql`
          mutation EditUpdateRelease($input: EditUpdateReleaseInput!) {
            updateRelease {
              editUpdateRelease(input: $input) {
                id
                releaseName
              }
            }
          }
        `,
        {
          input: {
            appId,
            releaseName,
            newReleaseName,
          },
        }
      )
      .toPromise()
  );
  return data.updateRelease.editUpdateRelease;
}

export default class ReleaseEdit extends Command {
  static description = 'Edit a release.';

  static args = [
    {
      name: 'releaseName',
      required: false,
      description: 'Name of the release to edit',
    },
  ];

  static flags = {
    rename: flags.string({
      description: 'what to rename the release.',
      required: false,
    }),
    json: flags.boolean({
      description: `return a json with the edited release's ID and name.`,
      default: false,
    }),
  };

  async run() {
    let {
      args: { releaseName },
      flags: { json: jsonFlag, rename: renameFlag },
    } = this.parse(ReleaseEdit);

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
        message: 'Please enter the name of the release to edit:',
        validate: value => (value ? true : validationMessage),
      }));
    }

    if (!renameFlag) {
      const validationMessage = '--rename may not be empty.';
      if (jsonFlag) {
        throw new Error(validationMessage);
      }
      ({ renameFlag } = await promptAsync({
        type: 'text',
        name: 'renameFlag',
        message: `Please rename ${releaseName}`,
        validate: value => (value ? true : validationMessage),
      }));
    }

    const editedRelease = await editUpdateReleaseOnAppAsync({
      appId: projectId,
      releaseName,
      newReleaseName: renameFlag!,
    });

    if (jsonFlag) {
      log(editedRelease);
      return;
    }

    log.withTick(
      `️Edited a release: ${chalk.bold(editedRelease.releaseName)} on project ${chalk.bold(
        `@${accountName}/${slug}`
      )}.`
    );
  }
}
