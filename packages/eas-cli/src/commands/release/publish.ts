import { getConfig } from '@expo/config';
import { Command, flags } from '@oclif/command';
import chalk from 'chalk';

import { PublishMutation } from '../../graphql/mutations/PublishMutation';
import log from '../../log';
import { ensureProjectExistsAsync } from '../../project/ensureProjectExists';
import {
  findProjectRootAsync,
  getProjectAccountNameAsync,
  getReleaseByNameAsync,
} from '../../project/projectUtils';
import { buildUpdateInfoGroup, collectAssets, uploadAssetsAsync } from '../../project/publish';
import { promptAsync } from '../../prompts';
import { getLastCommitMessageAsync } from '../../utils/git';

export default class ReleasePublish extends Command {
  static description = 'Publish an update group to a release.';

  static flags = {
    inputDir: flags.string({
      description: 'location of the bundle',
      required: false,
    }),
    releaseName: flags.string({
      description: 'current name of the release.',
    }),
    runtimeVersion: flags.string({
      description: 'runtime version of the updates',
      required: false,
    }),
    publishMessage: flags.string({
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
      flags: { json: jsonFlag, releaseName, runtimeVersion, publishMessage, inputDir },
    } = this.parse(ReleasePublish);

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

    if (!inputDir) {
      const validationMessage = 'input directory must be specified.';
      if (jsonFlag) {
        throw new Error(validationMessage);
      }
      ({ inputDir } = await promptAsync({
        type: 'text',
        name: 'inputDir',
        message: 'Please enter the name of the directory created by the bundler:',
        initial: 'dist',
        validate: value => (value ? true : validationMessage),
      }));
    }

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

    if (!runtimeVersion) {
      const validationMessage = 'runtimeVersion name may not be empty.';
      if (jsonFlag) {
        throw new Error(validationMessage);
      }
      ({ runtimeVersion } = await promptAsync({
        type: 'text',
        name: 'runtimeVersion',
        message: 'Please enter the runtime version of the updates',
        validate: value => (value ? true : validationMessage),
      }));
    }

    if (!publishMessage) {
      const validationMessage = 'publish message may not be empty.';
      if (jsonFlag) {
        throw new Error(validationMessage);
      }
      ({ publishMessage } = await promptAsync({
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
      `️Publishing "${publishMessage}" to ${releaseName}@${runtimeVersion} to on project ${chalk.bold(
        `@${accountName}/${slug}`
      )}.`
    );

    log.withTick('Collecting assets...');
    const assets = collectAssets(inputDir!);

    log.withTick('Uploading assets...');
    await uploadAssetsAsync(assets);
    const updateInfoGroup = buildUpdateInfoGroup(assets);

    log.withTick('Publishing...');
    const newUpdateGroup = await PublishMutation.publishUpdateGroupAsync({
      releaseId,
      updateInfoGroup,
      runtimeVersion: runtimeVersion!,
      updateMessage: publishMessage,
    });

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
