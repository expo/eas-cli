import { getConfig } from '@expo/config';
import { Command, flags } from '@oclif/command';
import { uniqBy } from '@oclif/plugin-help/lib/util';
import assert from 'assert';
import chalk from 'chalk';
import Table from 'cli-table3';
import dateFormat from 'dateformat';
import gql from 'graphql-tag';
import ora from 'ora';

import { graphqlClient, withErrorHandlingAsync } from '../../graphql/client';
import {
  GetUpdateGroupAsyncQuery,
  Maybe,
  Robot,
  RootQueryUpdatesByGroupArgs,
  Update,
  UpdateInfoGroup,
  User,
} from '../../graphql/generated';
import { PublishMutation } from '../../graphql/mutations/PublishMutation';
import Log from '../../log';
import { ensureProjectExistsAsync } from '../../project/ensureProjectExists';
import { findProjectRootAsync, getProjectAccountNameAsync } from '../../project/projectUtils';
import {
  buildBundlesAsync,
  buildUpdateInfoGroupAsync,
  collectAssets,
  uploadAssetsAsync,
} from '../../project/publish';
import { promptAsync, selectAsync } from '../../prompts';
import { getLastCommitMessageAsync } from '../../utils/git';
import { viewUpdateBranchAsync } from './view';

type PublishPlatforms = 'android' | 'ios';

export async function getUpdateGroupAsync({
  group,
}: RootQueryUpdatesByGroupArgs): Promise<
  Pick<Update, 'group' | 'runtimeVersion' | 'manifestFragment' | 'platform' | 'message'>[]
> {
  const data = await withErrorHandlingAsync(
    graphqlClient
      .query<GetUpdateGroupAsyncQuery, RootQueryUpdatesByGroupArgs>(
        gql`
          query getUpdateGroupAsync($group: ID!) {
            updatesByGroup(group: $group) {
              id
              group
              runtimeVersion
              manifestFragment
              platform
              message
            }
          }
        `,
        {
          group,
        }
      )
      .toPromise()
  );
  return data.updatesByGroup;
}
export default class BranchPublish extends Command {
  static hidden = true;
  static description = 'Publish an update group to a branch.';

  static flags = {
    branch: flags.string({
      description: 'name of the branch to publish on.',
    }),
    message: flags.string({
      description: 'Short message describing the updates.',
      required: false,
    }),
    republish: flags.boolean({
      description: 'republish an update group',
      exclusive: ['input-dir', 'skip-bundler'],
    }),
    group: flags.string({
      description: 'update group to republish',
      exclusive: ['input-dir', 'skip-bundler'],
    }),
    'input-dir': flags.string({
      description: 'location of the bundle',
      default: 'dist',
      required: false,
    }),
    'skip-bundler': flags.boolean({
      description: `skip running Expo CLI to bundle the app before publishing`,
      default: false,
    }),
    json: flags.boolean({
      description: `return a json with the new update group.`,
      default: false,
    }),
  };

  async run() {
    let {
      flags: {
        json: jsonFlag,
        branch: name,
        message,
        republish,
        group,
        'input-dir': inputDir,
        'skip-bundler': skipBundler,
      },
    } = this.parse(BranchPublish);
    // If a group was specified, that means we are republishing it.
    republish = group ? true : republish;

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
    assert(name, 'branch name must be specified.');

    const { id: branchId, updates } = await viewUpdateBranchAsync({
      appId: projectId,
      name,
    });

    let updateInfoGroup: UpdateInfoGroup = {};
    let oldMessage: string, oldRuntimeVersion: string;
    if (republish) {
      // If we are republishing, we don't need to worry about building the bundle or uploading the assets.
      // Instead we get the `updateInfoGroup` from the update we wish to republish.
      let updatesToRepublish: Pick<
        Update,
        'group' | 'message' | 'runtimeVersion' | 'manifestFragment' | 'platform'
      >[];
      if (group) {
        updatesToRepublish = await getUpdateGroupAsync({ group });
      } else {
        const updateGroups = uniqBy(updates, u => u.group).map(update => ({
          title: formatUpdateTitle(update),
          value: update.group,
        }));
        if (updateGroups.length === 0) {
          throw new Error(
            `There are no updates on branch "${name}". Did you mean to do a regular publish?`
          );
        }
        const updateGroup = await selectAsync<string>(
          'which update would you like to republish?',
          updateGroups
        );
        updatesToRepublish = updates.filter(update => update.group === updateGroup);
      }

      for (const update of updatesToRepublish) {
        const { platform, manifestFragment } = update;
        updateInfoGroup[platform as PublishPlatforms] = JSON.parse(manifestFragment);
      }
      // These are the same for each member of an update group
      group = updatesToRepublish[0].group;
      oldMessage = updatesToRepublish[0].message ?? '';
      oldRuntimeVersion = updatesToRepublish[0].runtimeVersion;
    } else {
      // build bundle and upload assets for a new publish
      if (!skipBundler) {
        await buildBundlesAsync({ projectDir, inputDir });
      }

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
        initial: republish
          ? `Republish "${oldMessage!}" - group: ${group}`
          : (await getLastCommitMessageAsync())?.trim(),
        validate: value => (value ? true : validationMessage),
      }));
    }

    let newUpdateGroup;
    const publishSpinner = ora('Publishing...').start();
    try {
      newUpdateGroup = await PublishMutation.publishUpdateGroupAsync({
        branchId,
        updateInfoGroup,
        runtimeVersion: republish ? oldRuntimeVersion! : runtimeVersion,
        message,
      });
      publishSpinner.succeed('Published!');
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
        [chalk.dim('branch'), name],
        [chalk.dim('runtimeVersion'), runtimeVersion],
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
