import { ExpoConfig, getConfig, getDefaultTarget } from '@expo/config';
import { getRuntimeVersionForSDKVersion } from '@expo/sdk-runtime-versions';
import { flags } from '@oclif/command';
import assert from 'assert';
import chalk from 'chalk';
import dateFormat from 'dateformat';
import gql from 'graphql-tag';
import ora from 'ora';

import EasCommand from '../../commandUtils/EasCommand';
import { graphqlClient, withErrorHandlingAsync } from '../../graphql/client';
import {
  GetUpdateGroupAsyncQuery,
  Robot,
  RootQueryUpdatesByGroupArgs,
  Update,
  UpdateInfoGroup,
  User,
  ViewBranchQuery,
} from '../../graphql/generated';
import { PublishMutation } from '../../graphql/mutations/PublishMutation';
import Log from '../../log';
import { findProjectRootAsync, getProjectIdAsync } from '../../project/projectUtils';
import {
  PublishPlatform,
  buildBundlesAsync,
  buildUnsortedUpdateInfoGroupAsync,
  collectAssets,
  uploadAssetsAsync,
} from '../../project/publish';
import { promptAsync, selectAsync } from '../../prompts';
import { formatUpdate } from '../../update/utils';
import uniqBy from '../../utils/expodash/uniqBy';
import formatFields from '../../utils/formatFields';
import vcs from '../../vcs';
import { createUpdateBranchOnAppAsync } from './create';
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

async function ensureBranchExistsAsync({
  appId,
  name: branchName,
}: {
  appId: string;
  name: string;
}): Promise<{
  id: string;
  updates: Exclude<
    Exclude<ViewBranchQuery['app'], null | undefined>['byId']['updateBranchByName'],
    null | undefined
  >['updates'];
}> {
  const { app } = await viewUpdateBranchAsync({
    appId,
    name: branchName,
  });
  const updateBranch = app?.byId.updateBranchByName;
  if (updateBranch) {
    const { id, updates } = updateBranch;
    return { id, updates };
  }

  const newUpdateBranch = await createUpdateBranchOnAppAsync({ appId, name: branchName });
  return { id: newUpdateBranch.id, updates: [] };
}

export default class BranchPublish extends EasCommand {
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
      description: 'short message describing the updates.',
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
      description: `only publish to a single platform`,
      options: [...defaultPublishPlatforms, 'all'],
      default: 'all',
      required: false,
    }),
    json: flags.boolean({
      description: `return a json with the new update group.`,
      default: false,
    }),
    auto: flags.boolean({
      description:
        'use the current git branch and commit message for the EAS branch and update message',
      default: false,
    }),
  };

  async runAsync(): Promise<void> {
    let {
      args: { name: branchName },
      flags: {
        json: jsonFlag,
        auto: autoFlag,
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

    const { exp } = getConfig(projectDir, {
      skipSDKVersionRequirement: true,
      isPublicConfig: true,
    });

    const runtimeVersions = getRuntimeVersionObject(exp, platformFlag, projectDir);

    const projectId = await getProjectIdAsync(exp);

    if (!branchName && autoFlag) {
      branchName =
        (await vcs.getBranchNameAsync()) || `branch-${Math.random().toString(36).substr(2, 4)}`;
    }

    if (!branchName) {
      const validationMessage = 'branch name may not be empty.';
      if (jsonFlag) {
        throw new Error(validationMessage);
      }

      const branches = await listBranchesAsync({ projectId });
      branchName = await selectAsync<string>(
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
      assert(branchName, 'branch name must be specified.');
    }

    const { id: branchId, updates } = await ensureBranchExistsAsync({
      appId: projectId,
      name: branchName,
    });

    let unsortedUpdateInfoGroups: UpdateInfoGroup = {};
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
        // Drop into interactive mode if the user has not specified an update group to republish.
        if (jsonFlag) {
          throw new Error('You must specify the update group to republish.');
        }

        const updateGroups = uniqBy(updates, u => u.group)
          .filter(update => {
            // Only show groups that have updates on the specified platform(s).
            return platformFlag === 'all' || update.platform === platformFlag;
          })
          .map(update => ({
            title: formatUpdateTitle(update),
            value: update.group,
          }));
        if (updateGroups.length === 0) {
          throw new Error(
            `There are no updates on branch "${branchName}" published on the platform(s) ${platformFlag}. Did you mean to publish a new update instead?`
          );
        }

        const selectedUpdateGroup = await selectAsync<string>(
          'which update would you like to republish?',
          updateGroups
        );
        updatesToRepublish = updates.filter(update => update.group === selectedUpdateGroup);
      }
      const updatesToRepublishFilteredByPlatform = updatesToRepublish.filter(
        // Only republish to the specified platforms
        update => platformFlag === 'all' || update.platform === platformFlag
      );
      if (updatesToRepublishFilteredByPlatform.length === 0) {
        throw new Error(
          `There are no updates on branch "${branchName}" published on the platform(s) "${platformFlag}" with group ID "${
            group ? group : updatesToRepublish[0].group
          }". Did you mean to publish a new update instead?`
        );
      }

      let publicationPlatformMessage: string;
      if (platformFlag === 'all') {
        if (updatesToRepublishFilteredByPlatform.length !== defaultPublishPlatforms.length) {
          Log.warn(`You are republishing an update that wasn't published for all platforms.`);
        }
        publicationPlatformMessage = `The republished update will appear on the same plaforms it was originally published on: ${updatesToRepublishFilteredByPlatform
          .map(update => update.platform)
          .join(',')}`;
      } else {
        publicationPlatformMessage = `The republished update will appear only on: ${platformFlag}`;
      }
      Log.withTick(publicationPlatformMessage);

      for (const update of updatesToRepublishFilteredByPlatform) {
        const { manifestFragment } = update;
        const platform = update.platform as PublishPlatform;

        unsortedUpdateInfoGroups[platform] = JSON.parse(manifestFragment);
      }

      // These are the same for each member of an update group
      group = updatesToRepublishFilteredByPlatform[0].group;
      oldMessage = updatesToRepublishFilteredByPlatform[0].message ?? '';
      oldRuntimeVersion = updatesToRepublishFilteredByPlatform[0].runtimeVersion;
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
        unsortedUpdateInfoGroups = await buildUnsortedUpdateInfoGroupAsync(assets, exp);
        assetSpinner.succeed('Uploaded assets!');
      } catch (e) {
        assetSpinner.fail('Failed to upload assets');
        throw e;
      }
    }

    if (!message && autoFlag) {
      message = (await vcs.getLastCommitMessageAsync())?.trim();
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
          : (await vcs.getLastCommitMessageAsync())?.trim(),
        validate: value => (value ? true : validationMessage),
      }));
    }

    const runtimeToPlatformMapping: Record<string, string[]> = {};
    for (const runtime of new Set(Object.values(runtimeVersions))) {
      runtimeToPlatformMapping[runtime] = Object.entries(runtimeVersions)
        .filter(pair => pair[1] === runtime)
        .map(pair => pair[0]);
    }

    // Sort the updates into different groups based on their platform specific runtime versions
    const updateGroups = Object.entries(runtimeToPlatformMapping).map(([runtime, platforms]) => {
      const localUpdateInfoGroup = Object.fromEntries(
        platforms.map(platform => [
          platform,
          unsortedUpdateInfoGroups[platform as keyof UpdateInfoGroup],
        ])
      );

      if (republish && !oldRuntimeVersion) {
        throw new Error(
          'Can not find the runtime version of the update group that is being republished.'
        );
      }
      return {
        branchId,
        updateInfoGroup: localUpdateInfoGroup,
        runtimeVersion: republish ? oldRuntimeVersion : runtime,
        message,
      };
    });
    let newUpdates;
    const publishSpinner = ora('Publishing...').start();
    try {
      newUpdates = await PublishMutation.publishUpdateGroupAsync(updateGroups);
      publishSpinner.succeed('Published!');
    } catch (e) {
      publishSpinner.fail('Failed to published updates');
      throw e;
    }

    if (jsonFlag) {
      Log.log(JSON.stringify(newUpdates));
    } else {
      if (new Set(newUpdates.map(update => update.group)).size > 1) {
        Log.addNewLineIfNone();
        Log.log(
          '👉 Since multiple runtime versions are defined, multiple update groups have been published.'
        );
      }

      Log.addNewLineIfNone();
      for (const runtime of new Set(Object.values(runtimeVersions))) {
        const platforms = newUpdates
          .filter(update => update.runtimeVersion === runtime)
          .map(update => update.platform);
        const newUpdate = newUpdates.find(update => update.runtimeVersion === runtime);
        if (!newUpdate) {
          throw new Error(`Publish response is missing updates with runtime ${runtime}.`);
        }
        Log.log(
          formatFields([
            { label: 'branch', value: branchName },
            { label: 'runtime version', value: runtime },
            { label: 'platform', value: platforms.join(',') },
            { label: 'update group ID', value: newUpdate.group },
            { label: 'message', value: message },
          ])
        );
        Log.addNewLineIfNone();
      }
    }
  }
}

function getRuntimeVersionObject(
  exp: ExpoConfig,
  platformFlag: string,
  projectDir: string
): Record<string, string> {
  let { runtimeVersion: defaultRuntimeVersion, sdkVersion } = exp;

  // When a SDK version is supplied instead of a runtime version and we're in the managed workflow
  // construct the runtimeVersion with special meaning indicating that the runtime is an
  // Expo SDK preset runtime that can be launched in Expo Go.
  const isManagedProject = getDefaultTarget(projectDir) === 'managed';
  if (!defaultRuntimeVersion && sdkVersion && isManagedProject) {
    Log.withTick('Generating runtime version from sdk version');
    defaultRuntimeVersion = getRuntimeVersionForSDKVersion(sdkVersion);
  }
  const iOSRuntimeVersion = (exp as any).ios?.runtimeVersion; // TODO-JJ remove cast to any
  const androidRuntimeVersion = (exp as any).android?.runtimeVersion; // TODO-JJ remove cast to any
  let runtimeVersions: Record<string, string>;
  switch (platformFlag) {
    case 'ios': {
      runtimeVersions = {
        ios: iOSRuntimeVersion ?? defaultRuntimeVersion,
      };
      break;
    }
    case 'android': {
      runtimeVersions = {
        android: androidRuntimeVersion ?? defaultRuntimeVersion,
      };
      break;
    }
    case 'all': {
      runtimeVersions = {
        ios: iOSRuntimeVersion ?? defaultRuntimeVersion,
        android: androidRuntimeVersion ?? defaultRuntimeVersion,
      };
      break;
    }
    default:
      throw new Error('Platform flag must be "ios", "android", or "all"');
  }
  if (Object.values(runtimeVersions).some(runtime => !runtime)) {
    throw new Error(
      "Couldn't find a 'runtimeVersion' for every platform. Please specify it under the 'expo' key in 'app.json'"
    );
  }
  if (Object.values(runtimeVersions).some(runtime => typeof runtime !== 'string')) {
    throw new Error(
      `Please ensure that all of the runtime versions defined in the app.json are strings.`
    );
  }

  return runtimeVersions;
}

function formatUpdateTitle(
  update: Exclude<
    Exclude<ViewBranchQuery['app'], null | undefined>['byId']['updateBranchByName'],
    null | undefined
  >['updates'][number]
): string {
  const { message, createdAt, actor, runtimeVersion } = update;

  let actorName: string;
  switch (actor?.__typename) {
    case 'User': {
      actorName = (actor as Pick<User, 'username' | 'id'>).username;
      break;
    }
    case 'Robot': {
      const { firstName, id } = actor as Pick<Robot, 'firstName' | 'id'>;
      actorName = firstName ?? `robot: ${id.slice(0, 4)}...`;
      break;
    }
    default:
      actorName = 'unknown';
  }
  return `[${dateFormat(
    createdAt,
    'mmm dd HH:MM'
  )} by ${actorName}, runtimeVersion: ${runtimeVersion}] ${message}`;
}
