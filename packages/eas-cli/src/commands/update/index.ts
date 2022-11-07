import { ExpoConfig, Platform as PublishPlatform } from '@expo/config';
import { Updates } from '@expo/config-plugins';
import { Platform, Workflow } from '@expo/eas-build-job';
import { Errors, Flags } from '@oclif/core';
import assert from 'assert';
import chalk from 'chalk';
import nullthrows from 'nullthrows';

import { ensureBranchExistsAsync, selectBranchOnAppAsync } from '../../branch/queries';
import { getDefaultBranchNameAsync } from '../../branch/utils';
import { getUpdateGroupUrl } from '../../build/utils/url';
import { ensureChannelExistsAsync } from '../../channel/queries';
import EasCommand from '../../commandUtils/EasCommand';
import { EasNonInteractiveAndJsonFlags } from '../../commandUtils/flags';
import { getPaginatedQueryOptions } from '../../commandUtils/pagination';
import fetch from '../../fetch';
import {
  PublishUpdateGroupInput,
  StatuspageServiceName,
  Update,
  UpdateInfoGroup,
  UpdatePublishMutation,
} from '../../graphql/generated';
import { PublishMutation } from '../../graphql/mutations/PublishMutation';
import { UpdateQuery } from '../../graphql/queries/UpdateQuery';
import Log, { learnMore, link } from '../../log';
import { ora } from '../../ora';
import { RequestedPlatform, requestedPlatformDisplayNames } from '../../platform';
import { getOwnerAccountForProjectIdAsync } from '../../project/projectUtils';
import {
  ExpoCLIExportPlatformFlag,
  buildBundlesAsync,
  buildUnsortedUpdateInfoGroupAsync,
  collectAssetsAsync,
  filterExportedPlatformsByFlag,
  isUploadedAssetCountAboveWarningThreshold,
  resolveInputDirectoryAsync,
  uploadAssetsAsync,
} from '../../project/publish';
import { resolveWorkflowAsync } from '../../project/workflow';
import { promptAsync } from '../../prompts';
import { ensureEASUpdatesIsConfiguredAsync } from '../../update/configure';
import { selectUpdateGroupOnBranchAsync } from '../../update/queries';
import { formatUpdateMessage, truncateString as truncateUpdateMessage } from '../../update/utils';
import {
  checkManifestBodyAgainstUpdateInfoGroup,
  getCodeSigningInfoAsync,
  getManifestBodyAsync,
  signManifestBody,
} from '../../utils/code-signing';
import formatFields from '../../utils/formatFields';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';
import { maybeWarnAboutEasOutagesAsync } from '../../utils/statuspageService';
import { getVcsClient } from '../../vcs';

export const defaultPublishPlatforms: Partial<PublishPlatform>[] = ['android', 'ios'];

type RawUpdateFlags = {
  auto: boolean;
  branch?: string;
  message?: string;
  group?: string;
  republish?: boolean;
  platform: string;
  'input-dir': string;
  'skip-bundler': boolean;
  'private-key-path'?: string;
  'non-interactive': boolean;
  json: boolean;
};

type UpdateFlags = {
  auto: boolean;
  platform: ExpoCLIExportPlatformFlag;
  branchName?: string;
  updateMessage?: string;
  republish: boolean;
  groupId?: string;
  inputDir: string;
  skipBundler: boolean;
  privateKeyPath?: string;
  json: boolean;
  nonInteractive: boolean;
};

function getRequestedPlatform(platform: ExpoCLIExportPlatformFlag): RequestedPlatform | null {
  switch (platform) {
    case 'android':
      return RequestedPlatform.Android;
    case 'ios':
      return RequestedPlatform.Ios;
    case 'web':
      return null;
    case 'all':
      return RequestedPlatform.All;
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}

export default class UpdatePublish extends EasCommand {
  static override description = 'publish an update group';

  static override flags = {
    branch: Flags.string({
      description: 'Branch to publish the update group on',
      required: false,
    }),
    message: Flags.string({
      description: 'A short message describing the update',
      required: false,
    }),
    republish: Flags.boolean({
      description: 'Republish an update group',
      exclusive: ['input-dir', 'skip-bundler'],
    }),
    group: Flags.string({
      description: 'Update group to republish',
      exclusive: ['input-dir', 'skip-bundler'],
    }),
    'input-dir': Flags.string({
      description: 'Location of the bundle',
      default: 'dist',
      required: false,
    }),
    'skip-bundler': Flags.boolean({
      description: `Skip running Expo CLI to bundle the app before publishing`,
      default: false,
    }),
    platform: Flags.enum({
      char: 'p',
      options: [
        // TODO: Add web when it's fully supported
        ...defaultPublishPlatforms,
        'all',
      ],
      default: 'all',
      required: false,
    }),
    auto: Flags.boolean({
      description:
        'Use the current git branch and commit message for the EAS branch and update message',
      default: false,
    }),
    'private-key-path': Flags.string({
      description: `File containing the PEM-encoded private key corresponding to the certificate in expo-updates' configuration. Defaults to a file named "private-key.pem" in the certificate's directory.`,
      required: false,
    }),
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.DynamicProjectConfig,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const { flags: rawFlags } = await this.parse(UpdatePublish);
    const paginatedQueryOptions = getPaginatedQueryOptions(rawFlags);
    let {
      auto: autoFlag,
      platform: platformFlag,
      branchName,
      updateMessage,
      republish,
      groupId,
      inputDir,
      skipBundler,
      privateKeyPath,
      json: jsonFlag,
      nonInteractive,
    } = this.sanitizeFlags(rawFlags);

    const {
      getDynamicProjectConfigAsync,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(UpdatePublish, {
      nonInteractive,
    });

    if (jsonFlag) {
      enableJsonOutput();
    }

    const {
      exp: expPossiblyWithoutEasUpdateConfigured,
      projectId,
      projectDir,
    } = await getDynamicProjectConfigAsync({
      isPublicConfig: true,
    });

    const { exp: expPrivate } = await getDynamicProjectConfigAsync({
      isPublicConfig: false,
    });

    await maybeWarnAboutEasOutagesAsync(graphqlClient, [StatuspageServiceName.EasUpdate]);

    await ensureEASUpdatesIsConfiguredAsync(graphqlClient, {
      exp: expPossiblyWithoutEasUpdateConfigured,
      platform: getRequestedPlatform(platformFlag),
      projectDir,
      projectId,
    });

    const { exp } = await getDynamicProjectConfigAsync();
    const codeSigningInfo = await getCodeSigningInfoAsync(expPrivate, privateKeyPath);

    let realizedPlatforms: PublishPlatform[] = [];

    if (!branchName) {
      if (autoFlag) {
        branchName = await getDefaultBranchNameAsync();
      } else if (nonInteractive) {
        throw new Error('Must supply --branch or use --auto when in non-interactive mode');
      } else {
        try {
          const branch = await selectBranchOnAppAsync(graphqlClient, {
            projectId,
            promptTitle: `Which branch would you like to ${
              republish ? 'republish' : 'publish'
            } on?`,
            displayTextForListItem: updateBranch =>
              `${updateBranch.name} ${chalk.grey(
                `- current update: ${formatUpdateMessage(updateBranch.updates[0])}`
              )}`,
            paginatedQueryOptions,
          });
          branchName = branch.name;
        } catch {
          // unable to select a branch (network error or no branches for project)
          ({ name: branchName } = await promptAsync({
            type: 'text',
            name: 'name',
            message: 'No branches found. Provide a branch name:',
            initial: await getDefaultBranchNameAsync(),
            validate: value => (value ? true : 'Branch name may not be empty.'),
          }));
        }

        assert(branchName, 'Branch name must be specified.');
      }
    }

    let unsortedUpdateInfoGroups: UpdateInfoGroup = {};
    let oldMessage: string, oldRuntimeVersion: string;
    let uploadedAssetCount = 0;
    let assetLimitPerUpdateGroup = 0;

    if (republish) {
      // If we are republishing, we don't need to worry about building the bundle or uploading the assets.
      // Instead we get the `updateInfoGroup` from the update we wish to republish.
      let updatesToRepublish: Pick<
        Update,
        'group' | 'message' | 'runtimeVersion' | 'manifestFragment' | 'platform'
      >[];
      if (groupId) {
        const updatesByGroup = await UpdateQuery.viewUpdateGroupAsync(graphqlClient, {
          groupId,
        });
        updatesToRepublish = updatesByGroup;
      } else {
        if (nonInteractive) {
          throw new Error('Must supply --group when in non-interactive mode');
        }

        updatesToRepublish = await selectUpdateGroupOnBranchAsync(graphqlClient, {
          projectId,
          branchName,
          paginatedQueryOptions,
        });
      }
      const updatesToRepublishFilteredByPlatform = updatesToRepublish.filter(
        // Only republish to the specified platforms
        update => platformFlag === 'all' || update.platform === platformFlag
      );
      if (updatesToRepublishFilteredByPlatform.length === 0) {
        throw new Error(
          `There are no updates on branch "${branchName}" published for the platform(s) "${platformFlag}" with group ID "${
            groupId ? groupId : updatesToRepublish[0].group
          }". Did you mean to publish a new update instead?`
        );
      }

      let publicationPlatformMessage: string;
      if (platformFlag === 'all') {
        if (updatesToRepublishFilteredByPlatform.length < defaultPublishPlatforms.length) {
          Log.warn(`You are republishing an update that wasn't published for all platforms.`);
        }
        publicationPlatformMessage = `The republished update will appear on the same platforms it was originally published on: ${updatesToRepublishFilteredByPlatform
          .map(update => update.platform)
          .join(', ')}`;
      } else {
        publicationPlatformMessage = `The republished update will appear only on: ${platformFlag}`;
      }
      Log.withTick(publicationPlatformMessage);

      for (const update of updatesToRepublishFilteredByPlatform) {
        const { manifestFragment } = update;
        const platform = update.platform as PublishPlatform;

        unsortedUpdateInfoGroups[platform] = JSON.parse(manifestFragment);
      }
      realizedPlatforms = updatesToRepublishFilteredByPlatform.map(
        update => update.platform as PublishPlatform
      );

      // These are the same for each member of an update group
      groupId = updatesToRepublishFilteredByPlatform[0].group;
      oldMessage = updatesToRepublishFilteredByPlatform[0].message ?? '';
      oldRuntimeVersion = updatesToRepublishFilteredByPlatform[0].runtimeVersion;

      if (!updateMessage) {
        if (nonInteractive) {
          throw new Error('Must supply --message when in non-interactive mode');
        }

        const validationMessage = 'publish message may not be empty.';
        if (jsonFlag) {
          throw new Error(validationMessage);
        }
        ({ updateMessage } = await promptAsync({
          type: 'text',
          name: 'updateMessage',
          message: `Provide an update message.`,
          initial: `Republish "${oldMessage!}" - group: ${groupId}`,
          validate: (value: any) => (value ? true : validationMessage),
        }));
      }
    } else {
      if (!updateMessage && autoFlag) {
        updateMessage = (await getVcsClient().getLastCommitMessageAsync())?.trim();
      }

      if (!updateMessage) {
        if (nonInteractive) {
          throw new Error('Must supply --message or use --auto when in non-interactive mode');
        }

        const validationMessage = 'publish message may not be empty.';
        if (jsonFlag) {
          throw new Error(validationMessage);
        }
        ({ updateMessage } = await promptAsync({
          type: 'text',
          name: 'updateMessage',
          message: `Provide an update message.`,
          initial: (await getVcsClient().getLastCommitMessageAsync())?.trim(),
          validate: (value: any) => (value ? true : validationMessage),
        }));
      }

      // build bundle and upload assets for a new publish
      if (!skipBundler) {
        const bundleSpinner = ora().start('Exporting...');
        try {
          await buildBundlesAsync({ projectDir, inputDir, exp, platformFlag });
          bundleSpinner.succeed('Exported bundle(s)');
        } catch (e) {
          bundleSpinner.fail('Export failed');
          throw e;
        }
      }

      // After possibly bundling, assert that the input directory can be found.
      const distRoot = await resolveInputDirectoryAsync(inputDir, { skipBundler });

      const assetSpinner = ora().start('Uploading...');

      try {
        const collectedAssets = await collectAssetsAsync(distRoot);
        const assets = filterExportedPlatformsByFlag(collectedAssets, platformFlag);
        realizedPlatforms = Object.keys(assets) as PublishPlatform[];

        const uploadResults = await uploadAssetsAsync(
          graphqlClient,
          assets,
          projectId,
          (totalAssets, missingAssets) => {
            assetSpinner.text = `Uploading (${totalAssets - missingAssets}/${totalAssets})`;
          }
        );

        uploadedAssetCount = uploadResults.uniqueUploadedAssetCount;
        assetLimitPerUpdateGroup = uploadResults.assetLimitPerUpdateGroup;
        unsortedUpdateInfoGroups = await buildUnsortedUpdateInfoGroupAsync(assets, exp);
        const uploadAssetSuccessMessage = uploadedAssetCount
          ? `Uploaded ${uploadedAssetCount} ${uploadedAssetCount === 1 ? 'platform' : 'platforms'}`
          : `Uploaded: No changes detected`;
        assetSpinner.succeed(uploadAssetSuccessMessage);
      } catch (e) {
        assetSpinner.fail('Failed to upload');
        throw e;
      }
    }

    const truncatedMessage = truncateUpdateMessage(updateMessage!, 1024);
    if (truncatedMessage !== updateMessage) {
      Log.warn('Update message exceeds the allowed 1024 character limit. Truncating message...');
    }

    const runtimeVersions = await getRuntimeVersionObjectAsync(exp, realizedPlatforms, projectDir);

    const runtimeToPlatformMapping: { runtimeVersion: string; platforms: string[] }[] = [];
    for (const runtime of runtimeVersions) {
      const platforms = runtimeVersions
        .filter(({ runtimeVersion }) => runtimeVersion === runtime.runtimeVersion)
        .map(({ platform }) => platform);
      if (!runtimeToPlatformMapping.find(item => item.runtimeVersion === runtime.runtimeVersion)) {
        runtimeToPlatformMapping.push({ runtimeVersion: runtime.runtimeVersion, platforms });
      }
    }

    const { branchId } = await ensureBranchExistsAsync(graphqlClient, {
      appId: projectId,
      branchName,
    });
    await ensureChannelExistsAsync(graphqlClient, {
      appId: projectId,
      branchId,
      channelName: branchName,
    });
    Log.withTick(`Channel: ${chalk.bold(branchName)} pointed at branch: ${chalk.bold(branchName)}`);

    const gitCommitHash = await getVcsClient().getCommitHashAsync();

    // Sort the updates into different groups based on their platform specific runtime versions
    const updateGroups: PublishUpdateGroupInput[] = runtimeToPlatformMapping.map(
      ({ runtimeVersion, platforms }) => {
        const localUpdateInfoGroup = Object.fromEntries(
          platforms.map(platform => [
            platform,
            unsortedUpdateInfoGroups[platform as keyof UpdateInfoGroup],
          ])
        );

        if (republish && !oldRuntimeVersion) {
          throw new Error(
            'Cannot find the runtime version of the update group that is being republished.'
          );
        }
        return {
          branchId,
          updateInfoGroup: localUpdateInfoGroup,
          runtimeVersion: republish ? oldRuntimeVersion : runtimeVersion,
          message: truncatedMessage,
          gitCommitHash,
          awaitingCodeSigningInfo: !!codeSigningInfo,
        };
      }
    );
    let newUpdates: UpdatePublishMutation['updateBranch']['publishUpdateGroups'];
    const publishSpinner = ora('Publishing...').start();
    try {
      newUpdates = await PublishMutation.publishUpdateGroupAsync(graphqlClient, updateGroups);

      if (codeSigningInfo) {
        Log.log('🔒 Signing updates');

        const updatesTemp = [...newUpdates];
        const updateGroupsAndTheirUpdates = updateGroups.map(updateGroup => {
          const newUpdates = updatesTemp.splice(0, Object.keys(updateGroup.updateInfoGroup).length);
          return {
            updateGroup,
            newUpdates,
          };
        });

        await Promise.all(
          updateGroupsAndTheirUpdates.map(async ({ updateGroup, newUpdates }) => {
            await Promise.all(
              newUpdates.map(async newUpdate => {
                const response = await fetch(newUpdate.manifestPermalink, {
                  method: 'GET',
                  headers: { accept: 'multipart/mixed' },
                });
                const manifestBody = nullthrows(await getManifestBodyAsync(response));

                checkManifestBodyAgainstUpdateInfoGroup(
                  manifestBody,
                  nullthrows(
                    updateGroup.updateInfoGroup[newUpdate.platform as keyof UpdateInfoGroup]
                  )
                );

                const manifestSignature = signManifestBody(manifestBody, codeSigningInfo);

                await PublishMutation.setCodeSigningInfoAsync(graphqlClient, newUpdate.id, {
                  alg: codeSigningInfo.codeSigningMetadata.alg,
                  keyid: codeSigningInfo.codeSigningMetadata.keyid,
                  sig: manifestSignature,
                });
              })
            );
          })
        );
      }

      publishSpinner.succeed('Published!');
    } catch (e) {
      publishSpinner.fail('Failed to publish updates');
      throw e;
    }

    if (jsonFlag) {
      printJsonOnlyOutput(newUpdates);
    } else {
      if (new Set(newUpdates.map(update => update.group)).size > 1) {
        Log.addNewLineIfNone();
        Log.log(
          '👉 Since multiple runtime versions are defined, multiple update groups have been published.'
        );
      }

      Log.addNewLineIfNone();

      for (const runtime of runtimeVersions) {
        const newUpdatesForRuntimeVersion = newUpdates.filter(
          update => update.runtimeVersion === runtime.runtimeVersion
        );
        if (newUpdatesForRuntimeVersion.length === 0) {
          throw new Error(
            `Publish response is missing updates with runtime ${runtime.runtimeVersion}.`
          );
        }
        const platforms = newUpdatesForRuntimeVersion.map(update => update.platform);
        const newAndroidUpdate = newUpdatesForRuntimeVersion.find(
          update => update.platform === 'android'
        );
        const newIosUpdate = newUpdatesForRuntimeVersion.find(update => update.platform === 'ios');
        const updateGroupId = newUpdatesForRuntimeVersion[0].group;

        const projectName = exp.slug;
        const accountName = (await getOwnerAccountForProjectIdAsync(graphqlClient, projectId)).name;
        const updateGroupUrl = getUpdateGroupUrl(accountName, projectName, updateGroupId);
        const updateGroupLink = link(updateGroupUrl, { dim: false });

        Log.log(
          formatFields([
            { label: 'Branch', value: branchName },
            { label: 'Runtime version', value: runtime.runtimeVersion },
            { label: 'Platform', value: platforms.join(', ') },
            { label: 'Update group ID', value: updateGroupId },
            ...(newAndroidUpdate
              ? [{ label: 'Android update ID', value: newAndroidUpdate.id }]
              : []),
            ...(newIosUpdate ? [{ label: 'iOS update ID', value: newIosUpdate.id }] : []),
            { label: 'Message', value: truncatedMessage },
            ...(gitCommitHash ? [{ label: 'Commit', value: gitCommitHash }] : []),
            { label: 'Website link', value: updateGroupLink },
          ])
        );
        Log.addNewLineIfNone();
        if (
          isUploadedAssetCountAboveWarningThreshold(uploadedAssetCount, assetLimitPerUpdateGroup)
        ) {
          Log.warn(
            `This update group contains ${uploadedAssetCount} assets and is nearing the server cap of ${assetLimitPerUpdateGroup}.\n` +
              `${learnMore('https://docs.expo.dev/eas-update/optimize-assets/', {
                learnMoreMessage: 'Consider optimizing your usage of assets',
                dim: false,
              })}.`
          );
          Log.addNewLineIfNone();
        }
      }
    }
  }

  private sanitizeFlags(flags: RawUpdateFlags): UpdateFlags {
    const nonInteractive = flags['non-interactive'] ?? false;

    const { auto, branch: branchName, message: updateMessage } = flags;
    if (nonInteractive && !auto && !(branchName && updateMessage)) {
      Errors.error(
        '--auto or both --branch and --message are required when updating in non-interactive mode',
        { exit: 1 }
      );
    }

    const groupId = flags.group;
    const republish = flags.republish || !!groupId; // When --group is defined, we are republishing
    if (nonInteractive && republish && !groupId) {
      Errors.error(`--group is required when updating in non-interactive mode`, { exit: 1 });
    }

    return {
      auto,
      branchName,
      updateMessage,
      groupId,
      republish,
      inputDir: flags['input-dir'],
      skipBundler: flags['skip-bundler'],
      platform: flags.platform as RequestedPlatform,
      privateKeyPath: flags['private-key-path'],
      nonInteractive,
      json: flags.json ?? false,
    };
  }
}

/** Get runtime versions grouped by platform. Runtime version is always `null` on web where the platform is always backwards compatible. */
async function getRuntimeVersionObjectAsync(
  exp: ExpoConfig,
  platforms: PublishPlatform[],
  projectDir: string
): Promise<{ platform: string; runtimeVersion: string }[]> {
  for (const platform of platforms) {
    if (platform === 'web') {
      continue;
    }
    const isPolicy = typeof (exp[platform]?.runtimeVersion ?? exp.runtimeVersion) === 'object';
    if (isPolicy) {
      const isManaged =
        (await resolveWorkflowAsync(projectDir, platform as Platform)) === Workflow.MANAGED;
      if (!isManaged) {
        throw new Error(
          'Runtime version policies are only supported in the managed workflow. In the bare workflow, runtime version needs to be set manually.'
        );
      }
    }
  }

  return [...new Set(platforms)].map(platform => {
    if (platform === 'web') {
      return { platform: 'web', runtimeVersion: 'UNVERSIONED' };
    }
    return {
      platform,
      runtimeVersion: nullthrows(
        Updates.getRuntimeVersion(exp, platform),
        `Unable to determine runtime version for ${
          requestedPlatformDisplayNames[platform]
        }. ${learnMore('https://docs.expo.dev/eas-update/runtime-versions/')}`
      ),
    };
  });
}
