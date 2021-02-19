import { getConfig } from '@expo/config';
import { Command, flags } from '@oclif/command';
import chalk from 'chalk';
import Table from 'cli-table3';
import ora from 'ora';

import { PublishMutation } from '../../graphql/mutations/PublishMutation';
import Log from '../../log';
import { ensureProjectExistsAsync } from '../../project/ensureProjectExists';
import {
  findProjectRootAsync,
  getBranchByNameAsync,
  getProjectAccountNameAsync,
} from '../../project/projectUtils';
import { buildUpdateInfoGroupAsync, collectAssets, uploadAssetsAsync } from '../../project/publish';
import { promptAsync } from '../../prompts';
import { getLastCommitMessageAsync } from '../../utils/git';

export default class BranchPublish extends Command {
  static hidden = true;
  static description = 'Publish an update group to a branch.';

  static flags = {
    'input-dir': flags.string({
      description: 'location of the bundle',
      default: 'dist',
      required: false,
    }),
    branch: flags.string({
      description: 'current name of the branch.',
    }),
    message: flags.string({
      description: 'Short message describing the updates.',
      required: false,
    }),
    json: flags.boolean({
      description: `return a json with the edited branch's ID and name.`,
      default: false,
    }),
  };

  async run() {
    let {
      flags: { json: jsonFlag, branch: name, message, 'input-dir': inputDir },
    } = this.parse(BranchPublish);

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
        "Couldn't find 'runtimeVersion'. Please specify it under the 'expo' key in 'app.json'"
      );
    }
    const projectId = await ensureProjectExistsAsync({
      accountName,
      projectName: slug,
    });

    if (!name) {
      const validationMessage = 'branch name may not be empty.';
      if (jsonFlag) {
        throw new Error(validationMessage);
      }
      ({ name } = await promptAsync({
        type: 'text',
        name: 'name',
        message: 'Please enter the name of the branch to publish on:',
        validate: value => (value ? true : validationMessage),
      }));
    }

    if (!message) {
      const validationMessage = 'publish message may not be empty.';
      if (jsonFlag) {
        throw new Error(validationMessage);
      }
      ({ publishMessage: message } = await promptAsync({
        type: 'text',
        name: 'publishMessage',
        message: `Please enter a publication message.`,
        initial: (await getLastCommitMessageAsync())?.trim(),
        validate: value => (value ? true : validationMessage),
      }));
    }

    const { id: branchId } = await getBranchByNameAsync({
      appId: projectId,
      name: name!,
    });

    let updateInfoGroup;
    const assetSpinner = ora('Uploading assets...').start();
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
    const publishSpinner = ora('Publishing...').start();
    try {
      newUpdateGroup = await PublishMutation.publishUpdateGroupAsync({
        branchId,
        updateInfoGroup,
        runtimeVersion,
        message,
      });
      publishSpinner.succeed('Published!');
    } catch (e) {
      publishSpinner.fail('Failed to published updates');
      throw e;
    }

    if (jsonFlag) {
      Log.log(newUpdateGroup);
    } else {
      const outputMessage = new Table({
        wordWrap: true,
        chars: {
          top: '',
          'top-mid': '',
          'top-left': '',
          'top-right': '',
          bottom: '',
          'bottom-mid': '',
          'bottom-left': '',
          'bottom-right': '',
          left: '',
          'left-mid': '',
          mid: '',
          'mid-mid': '',
          right: '',
          'right-mid': '',
          middle: ' ',
        },
        style: { 'padding-left': 0, 'padding-right': 0 },
      });
      outputMessage.push(
        [chalk.dim('project'), `@${accountName}/${slug}`],
        [chalk.dim('branch'), name],
        [chalk.dim('runtimeVersion'), runtimeVersion],
        [chalk.dim('groupID'), newUpdateGroup.group],
        [chalk.dim('message'), message]
      );
      Log.log(outputMessage.toString());
    }
  }
}
