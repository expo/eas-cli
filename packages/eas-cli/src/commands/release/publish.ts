import { getConfig } from '@expo/config';
import { Command, flags } from '@oclif/command';
import chalk from 'chalk';
import ora from 'ora';

import { PublishMutation } from '../../graphql/mutations/PublishMutation';
import log from '../../log';
import { ensureProjectExistsAsync } from '../../project/ensureProjectExists';
import {
  findProjectRootAsync,
  getProjectAccountNameAsync,
  getReleaseByNameAsync,
} from '../../project/projectUtils';
import { buildUpdateInfoGroupAsync, collectAssets, uploadAssetsAsync } from '../../project/publish';
import { promptAsync } from '../../prompts';
import { getLastCommitMessageAsync } from '../../utils/git';

export default class ReleasePublish extends Command {
  static description = 'Publish an update group to a release.';

  static flags = {
    'input-dir': flags.string({
      description: 'location of the bundle',
      default: 'dist',
      required: false,
    }),
    release: flags.string({
      description: 'current name of the release.',
    }),
    message: flags.string({
      description: 'Short message describing the updates.',
      required: false,
    }),
    json: flags.boolean({
      description: `return a json with the edited release's ID and name.`,
      default: false,
    }),
  };

  async run() {
    let {
      flags: {
        json: jsonFlag,
        release: releaseName,
        message: updateMessage,
        'input-dir': inputDir,
      },
    } = this.parse(ReleasePublish);

    const projectDir = await findProjectRootAsync(process.cwd());
    if (!projectDir) {
      throw new Error('Please run this command inside a project directory.');
    }

    const accountName = await getProjectAccountNameAsync(projectDir);
    const {
      exp: { slug, runtimeVersion },
    } = getConfig(projectDir, { skipSDKVersionRequirement: true });
    if (!runtimeVersion) {
      throw new Error(
        "Couldn't find either 'runtimeVersion'. Please specify it under the 'expo' key in 'app.json'"
      );
    }
    const projectId = await ensureProjectExistsAsync({
      accountName,
      projectName: slug,
    });

    if (!releaseName) {
      const validationMessage = 'release name may not be empty.';
      if (jsonFlag) {
        throw new Error(validationMessage);
      }
      ({ releaseName } = await promptAsync({
        type: 'text',
        name: 'releaseName',
        message: 'Please enter the name of the release to publish on:',
        validate: value => (value ? true : validationMessage),
      }));
    }

    if (!updateMessage) {
      const validationMessage = 'publish message may not be empty.';
      if (jsonFlag) {
        throw new Error(validationMessage);
      }
      ({ publishMessage: updateMessage } = await promptAsync({
        type: 'text',
        name: 'publishMessage',
        message: `Please enter a publication message.`,
        initial: (await getLastCommitMessageAsync())?.trim(),
        validate: value => (value ? true : validationMessage),
      }));
    }

    const { id: releaseId } = await getReleaseByNameAsync({
      appId: projectId,
      releaseName: releaseName!,
    });

    log.withTick(
      `️Publishing "${updateMessage}" to ${releaseName}@${runtimeVersion} to on project ${chalk.bold(
        `@${accountName}/${slug}`
      )}.`
    );

    let updateInfoGroup;
    const assetSpinner = ora('Uploading assets').start();
    try {
      const assets = collectAssets(inputDir!);
      await uploadAssetsAsync(assets);
      updateInfoGroup = await buildUpdateInfoGroupAsync(assets);
      assetSpinner.succeed('Uploaded assets!');
    } catch (e) {
      assetSpinner.fail('Failed to upload assets');
      throw e;
    }

    let newUpdateGroup;
    const publishSpinner = ora('Publishing updates').start();
    try {
      newUpdateGroup = await PublishMutation.publishUpdateGroupAsync({
        releaseId,
        updateInfoGroup,
        runtimeVersion,
        updateMessage,
      });
      publishSpinner.succeed('Published updates!');
    } catch (e) {
      publishSpinner.fail('Failed to published updates');
      throw e;
    }

    if (jsonFlag) {
      log(newUpdateGroup);
      return;
    }
    log.withTick(
      `Published update group ${
        newUpdateGroup.updateGroup
      } to release ${releaseName}@${runtimeVersion} on app ${chalk.bold(
        `@${accountName}/${slug}`
      )}!`
    );
  }
}
