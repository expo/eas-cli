import { getConfig, getDefaultTarget } from '@expo/config';
import { getRuntimeVersionForSDKVersion } from '@expo/sdk-runtime-versions';
import { Command, flags } from '@oclif/command';
import assert from 'assert';
import chalk from 'chalk';
import Table from 'cli-table3';
import dateFormat from 'dateformat';
import gql from 'graphql-tag';
import { uniqBy } from 'lodash';
import ora from 'ora';

import { graphqlClient, withErrorHandlingAsync } from '../../graphql/client';
import {
  Actor,
  GetUpdateGroupAsyncQuery,
  RootQueryUpdatesByGroupArgs,
  Update,
  UpdateInfoGroup,
} from '../../graphql/generated';
import { PublishMutation } from '../../graphql/mutations/PublishMutation';
import Log from '../../log';
import {
  findProjectRootAsync,
  getProjectAccountNameAsync,
  getProjectIdAsync,
} from '../../project/projectUtils';
import {
  PublishPlatform,
  buildBundlesAsync,
  buildUpdateInfoGroupAsync,
  collectAssets,
  uploadAssetsAsync,
} from '../../project/publish';
import { promptAsync, selectAsync } from '../../prompts';
import { formatUpdate } from '../../update/utils';
import { getLastCommitMessageAsync } from '../../utils/git';
import { listBranchesAsync } from './list';
import { viewUpdateBranchAsync } from './view';

export const defaultPublishPlatforms: PublishPlatform[] = ['android', 'ios'];
type PlatformFlag = PublishPlatform | 'all';

async function getUpdateGroupAsync({
  group,
}: RootQueryUpdatesByGroupArgs): Promise<GetUpdateGroupAsyncQuery['updatesByGroup']> {
  const { updatesByGroup } = await withErrorHandlingAsync(
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
  return updatesByGroup;
}

export default class BranchPublish extends Command {
  static hidden = true;
  static description = 'Publish an update group to a branch.';

  static args = [
    {
      name: 'name',
      description: 'Name of the branch to publish on',
    },
  ];

  static flags = {
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
    platform: flags.enum({
      char: 'p',
      description: `Only publish to a single platform`,
      options: [...defaultPublishPlatforms, 'all'],
      default: 'all',
      required: false,
    }),
    json: flags.boolean({
      description: `return a json with the new update group.`,
      default: false,
    }),
  };

  async run() {
    let {
      args: { name },
      flags: {
        json: jsonFlag,
        message,
        republish,
        group,
        'input-dir': inputDir,
        'skip-bundler': skipBundler,
      },
    } = this.parse(BranchPublish);
    const platformFlag = this.parse(BranchPublish).flags.platform as PlatformFlag;
    // If a group was specified, that means we are republishing it.
    republish = group ? true : republish;

    const projectDir = await findProjectRootAsync(process.cwd());
    if (!projectDir) {
      throw new Error('Please run this command inside a project directory.');
    }

    const { exp } = getConfig(projectDir, { skipSDKVersionRequirement: true });
    const accountName = await getProjectAccountNameAsync(exp);
    let { slug, runtimeVersion, sdkVersion } = exp;

    // When a SDK version is supplied instead of a runtime version and we're in the managed workflow
    // construct the runtimeVersion with special meaning indicating that the runtime is an
    // Expo SDK preset runtime that can be launched in Expo Go.
    const isManagedProject = getDefaultTarget(projectDir) === 'managed';
    if (!runtimeVersion && sdkVersion && isManagedProject) {
      Log.withTick('Generating runtime version from sdk version');
      runtimeVersion = getRuntimeVersionForSDKVersion(sdkVersion);
    }

    if (!runtimeVersion) {
      throw new Error(
        "Couldn't find 'runtimeVersion'. Please specify it under the 'expo' key in 'app.json'"
      );
    }
    const projectId = await getProjectIdAsync(exp);

    if (!name) {
      const validationMessage = 'branch name may not be empty.';
      if (jsonFlag) {
        throw new Error(validationMessage);
      }

      const branches = await listBranchesAsync({ projectId });
      name = await selectAsync<string>(
        'which branch would you like to publish on?',
        branches.map(branch => {
          return {
            title: `${branch.name} ${chalk.grey(
              `- current update: ${formatUpdate(branch.updates[0])}`
            )}`,
            value: branch.name,
          };
        })
      );
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

      if (updatesToRepublish.length === 0) {
        throw new Error(`There are no updates in this group`);
      }

      for (const update of updatesToRepublish) {
        const { manifestFragment } = update;
        const platform = update.platform as PublishPlatform;

        if (platformFlag === 'all' || platformFlag === platform) {
          updateInfoGroup[platform] = JSON.parse(manifestFragment);
        }
      }

      if (Object.keys(updateInfoGroup).length === 0) {
        throw new Error(`There are no updates for platform ${platformFlag} in this group`);
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
        const platforms = platformFlag === 'all' ? defaultPublishPlatforms : [platformFlag];
        const assets = collectAssets({ inputDir: inputDir!, platforms });
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
    actor?: Pick<Actor, 'firstName'> | null;
  }
): string {
  const { message, createdAt, actor, runtimeVersion } = update;
  return `[${dateFormat(createdAt, 'mmm dd HH:MM')} by ${
    actor?.firstName ?? 'unknown'
  }, runtimeVersion: ${runtimeVersion}] ${message}`;
}
