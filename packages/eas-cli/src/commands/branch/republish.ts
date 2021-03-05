import { getConfig } from '@expo/config';
import { Command, flags } from '@oclif/command';
import assert from 'assert';
import chalk from 'chalk';
import Table from 'cli-table3';
import dateFormat from 'dateformat';
import uniqBy from 'lodash/uniqBy';
import ora from 'ora';

import { Maybe, Robot, Update, UpdateInfoGroup, User } from '../../graphql/generated';
import { PublishMutation } from '../../graphql/mutations/PublishMutation';
import Log from '../../log';
import { ensureProjectExistsAsync } from '../../project/ensureProjectExists';
import { findProjectRootAsync, getProjectAccountNameAsync } from '../../project/projectUtils';
import { promptAsync, selectAsync } from '../../prompts';
import { listBranchesAsync } from './list';
import { viewUpdateBranchAsync } from './view';

export default class BranchRepublish extends Command {
  static hidden = true;
  static description = 'Republish an update group to a branch.';

  static flags = {
    branch: flags.string({
      description: 'name of the branch to publish on.',
    }),
    message: flags.string({
      description: 'Short message describing the republish.',
      required: false,
    }),
    json: flags.boolean({
      description: `return a json with the new update group.`,
      default: false,
    }),
  };

  async run() {
    const {
      flags: { json: jsonFlag },
    } = this.parse(BranchRepublish);
    let {
      flags: { branch: branchName, message },
    } = this.parse(BranchRepublish);

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

    if (!branchName) {
      const branches = await listBranchesAsync({ fullName: `@${accountName}/${slug}` });

      branchName = await selectAsync<string>(
        'which branch would you like to publish on?',
        branches.map(branch => {
          return { title: branch.name, value: branch.name };
        })
      );
    }

    const { id: branchId, updates } = await viewUpdateBranchAsync({
      appId: projectId,
      name: branchName,
    });

    const updateGroups = uniqBy(updates, u => u.group).map(update => ({
      title: formatUpdateTitle(update),
      value: update.group,
    }));
    const updateGroup = await selectAsync<string>(
      'which update would you like to republish?',
      updateGroups
    );

    const updatesToRepublish = updates.filter(update => update.group === updateGroup);
    const { message: oldMessage, runtimeVersion: oldRuntimeVersion } = updatesToRepublish[0]; // These are the same for each member of an update group
    const updateInfoGroup: UpdateInfoGroup = {};
    for (const update of updatesToRepublish) {
      const { platform, manifestFragment } = update;
      updateInfoGroup[platform as 'android' | 'ios'] = JSON.parse(manifestFragment);
    }

    if (!message) {
      const validationMessage = 'publish message may not be empty.';
      if (jsonFlag) {
        throw new Error(validationMessage);
      }
      const { publishMessage } = await promptAsync({
        type: 'text',
        name: 'publishMessage',
        message: `Please enter a publication message.`,
        initial: `Republish "${oldMessage}" - group: ${updateGroup}`,
        validate: value => (value ? true : validationMessage),
      });
      message = publishMessage;
    }

    let newUpdateGroup;
    const publishSpinner = ora('Republishing...').start();
    try {
      assert(oldRuntimeVersion, 'runtimeVersion must be defined.');
      newUpdateGroup = await PublishMutation.publishUpdateGroupAsync({
        branchId,
        updateInfoGroup,
        runtimeVersion: oldRuntimeVersion,
        message,
      });
      publishSpinner.succeed('Republished!');
    } catch (e) {
      publishSpinner.fail('Failed to published updates');
      throw e;
    }

    if (jsonFlag) {
      Log.log(JSON.stringify(newUpdateGroup));
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
        [chalk.dim('branch'), branchName],
        [chalk.dim('runtimeVersion'), oldRuntimeVersion],
        [chalk.dim('groupID'), newUpdateGroup.group],
        [chalk.dim('message'), message]
      );
      Log.log(outputMessage.toString());
    }
  }
}

function formatUpdateTitle(
  update: Pick<Update, 'message' | 'createdAt' | 'runtimeVersion'> & {
    actor?: Maybe<Pick<User, 'firstName' | 'id'> | Pick<Robot, 'firstName' | 'id'>>;
  }
): string {
  const { message, createdAt, actor, runtimeVersion } = update;
  return `[${dateFormat(createdAt, 'mmm dd HH:MM')} by ${
    actor?.firstName ?? 'unknown'
  }, runtimeVersion: ${runtimeVersion}] ${message}`;
}
