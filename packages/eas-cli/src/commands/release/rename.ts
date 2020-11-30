import { getConfig } from '@expo/config';
import { Command, flags } from '@oclif/command';
import chalk from 'chalk';
import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../../graphql/client';
import log from '../../log';
import { ensureProjectExistsAsync } from '../../project/ensureProjectExists';
import { findProjectRootAsync, getProjectAccountNameAsync } from '../../project/projectUtils';
import { promptAsync } from '../../prompts';
import { EditUpdateReleaseInput, UpdateRelease } from '../../graphql/generated';

async function renameUpdateReleaseOnAppAsync({
  appId,
  currentName,
  newName,
}: {
  appId: string;
  currentName: string;
  newName: string;
}): Promise<UpdateRelease> {
  const data = await withErrorHandlingAsync(
    graphqlClient
      .mutation<
        { updateRelease: { editUpdateRelease: UpdateRelease } },
        {
          input: EditUpdateReleaseInput;
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
            releaseName: currentName,
            newReleaseName: newName,
          },
        }
      )
      .toPromise()
  );
  return data.updateRelease.editUpdateRelease;
}

export default class ReleaseRename extends Command {
  static description = 'Edit a release.';

  static flags = {
    from: flags.string({
      description: 'current name of the release.',
      required: false,
    }),
    to: flags.string({
      description: 'new name of the release.',
      required: false,
    }),
    json: flags.boolean({
      description: `return a json with the edited release's ID and name.`,
      default: false,
    }),
  };

  async run() {
    let {
      flags: { json: jsonFlag, from: currentName, to: newName },
    } = this.parse(ReleaseRename);

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

    if (!currentName) {
      const validationMessage = 'current name may not be empty.';
      if (jsonFlag) {
        throw new Error(validationMessage);
      }
      ({ currentName } = await promptAsync({
        type: 'text',
        name: 'currentName',
        message: 'Please enter the current name of the release to rename:',
        validate: value => (value ? true : validationMessage),
      }));
    }

    if (!newName) {
      const validationMessage = 'new name may not be empty.';
      if (jsonFlag) {
        throw new Error(validationMessage);
      }
      ({ newName } = await promptAsync({
        type: 'text',
        name: 'newName',
        message: `Please rename ${currentName}`,
        validate: value => (value ? true : validationMessage),
      }));
    }

    const editedRelease = await renameUpdateReleaseOnAppAsync({
      appId: projectId,
      currentName: currentName!,
      newName: newName!,
    });

    if (jsonFlag) {
      log(editedRelease);
      return;
    }

    log.withTick(
      `️Renamed release from ${currentName} to ${chalk.bold(
        editedRelease.releaseName
      )} on project ${chalk.bold(`@${accountName}/${slug}`)}.`
    );
  }
}
