import { Platform as PublishPlatform } from '@expo/config';
import { Errors, Flags } from '@oclif/core';
import chalk from 'chalk';
import nullthrows from 'nullthrows';

import { ensureBranchExistsAsync } from '../../branch/queries';
import { getUpdateGroupUrl } from '../../build/utils/url';
import { ensureChannelExistsAsync } from '../../channel/queries';
import EasCommand from '../../commandUtils/EasCommand';
import { EasNonInteractiveAndJsonFlags } from '../../commandUtils/flags';
import { getPaginatedQueryOptions } from '../../commandUtils/pagination';
import fetch from '../../fetch';
import {
  PublishUpdateGroupInput,
  StatuspageServiceName,
  UpdateInfoGroup,
  UpdatePublishMutation,
} from '../../graphql/generated';
import { PublishMutation } from '../../graphql/mutations/PublishMutation';
import Log, { learnMore, link } from '../../log';
import { ora } from '../../ora';
import { RequestedPlatform } from '../../platform';
import { getOwnerAccountForProjectIdAsync } from '../../project/projectUtils';
import {
  ExpoCLIExportPlatformFlag,
  RawAsset,
  buildBundlesAsync,
  buildUnsortedUpdateInfoGroupAsync,
  collectAssetsAsync,
  defaultPublishPlatforms,
  filterExportedPlatformsByFlag,
  getBranchNameForCommandAsync,
  getRequestedPlatform,
  getRuntimeToPlatformMappingFromRuntimeVersions,
  getRuntimeVersionObjectAsync,
  getUpdateMessageForCommandAsync,
  isUploadedAssetCountAboveWarningThreshold,
  platformDisplayNames,
  resolveInputDirectoryAsync,
  uploadAssetsAsync,
} from '../../project/publish';
import { ensureEASUpdateIsConfiguredAsync } from '../../update/configure';
import { getUpdateGroupJsonInfo } from '../../update/utils';
import {
  checkManifestBodyAgainstUpdateInfoGroup,
  getCodeSigningInfoAsync,
  getManifestBodyAsync,
  signBody,
} from '../../utils/code-signing';
import areSetsEqual from '../../utils/expodash/areSetsEqual';
import uniqBy from '../../utils/expodash/uniqBy';
import formatFields from '../../utils/formatFields';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';
import { maybeWarnAboutEasOutagesAsync } from '../../utils/statuspageService';
import { getVcsClient } from '../../vcs';

type RawUpdateFlags = {
  auto: boolean;
  dev: boolean;
  branch?: string;
  channel?: string;
  message?: string;
  platform: string;
  'input-dir': string;
  'skip-bundler': boolean;
  'clear-cache': boolean;
  'private-key-path'?: string;
  'non-interactive': boolean;
  json: boolean;
  /** @deprecated see UpdateRepublish command */
  group?: string;
  /** @deprecated see UpdateRepublish command */
  republish?: boolean;
};

type UpdateFlags = {
  auto: boolean;
  dev: boolean;
  platform: ExpoCLIExportPlatformFlag;
  branchName?: string;
  channelName?: string;
  updateMessage?: string;
  inputDir: string;
  skipBundler: boolean;
  clearCache: boolean;
  privateKeyPath?: string;
  json: boolean;
  nonInteractive: boolean;
};

export default class UpdatePublish extends EasCommand {
  static override description = 'publish an update group';

  static override flags = {
    branch: Flags.string({
      description: 'Branch to publish the update group on',
      required: false,
    }),
    channel: Flags.string({
      description: 'Channel that the published update should affect',
      required: false,
    }),
    message: Flags.string({
      char: 'm',
      description: 'A short message describing the update',
      required: false,
    }),
    republish: Flags.boolean({
      description: 'Republish an update group (deprecated, see republish command)',
      exclusive: ['input-dir', 'skip-bundler'],
    }),
    group: Flags.string({
      description: 'Update group to republish (deprecated, see republish command)',
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
    'clear-cache': Flags.boolean({
      description: `Clear the bundler cache before publishing`,
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
    dev: Flags.boolean({
      description: 'Publish an unminified dev bundle without stripping __DEV__ global',
      default: false,
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
    const {
      auto: autoFlag,
      platform: platformFlag,
      channelName: channelNameArg,
      dev,
      updateMessage: updateMessageArg,
      inputDir,
      skipBundler,
      clearCache,
      privateKeyPath,
      json: jsonFlag,
      nonInteractive,
      branchName: branchNameArg,
    } = this.sanitizeFlags(rawFlags);

    const {
      getDynamicPublicProjectConfigAsync,
      getDynamicPrivateProjectConfigAsync,
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
    } = await getDynamicPublicProjectConfigAsync();

    await maybeWarnAboutEasOutagesAsync(graphqlClient, [StatuspageServiceName.EasUpdate]);

    await ensureEASUpdateIsConfiguredAsync(graphqlClient, {
      exp: expPossiblyWithoutEasUpdateConfigured,
      platform: getRequestedPlatform(platformFlag),
      projectDir,
      projectId,
    });

    const { exp } = await getDynamicPublicProjectConfigAsync();
    const { exp: expPrivate } = await getDynamicPrivateProjectConfigAsync();
    const codeSigningInfo = await getCodeSigningInfoAsync(expPrivate, privateKeyPath);

    const branchName = await getBranchNameForCommandAsync({
      graphqlClient,
      projectId,
      channelNameArg,
      branchNameArg,
      autoFlag,
      nonInteractive,
      paginatedQueryOptions,
    });

    const updateMessage = await getUpdateMessageForCommandAsync({
      updateMessageArg,
      autoFlag,
      nonInteractive,
      jsonFlag,
    });

    // build bundle and upload assets for a new publish
    if (!skipBundler) {
      const bundleSpinner = ora().start('Exporting...');
      try {
        await buildBundlesAsync({ projectDir, inputDir, dev, exp, platformFlag, clearCache });
        bundleSpinner.succeed('Exported bundle(s)');
      } catch (e) {
        bundleSpinner.fail('Export failed');
        throw e;
      }
    }

    // After possibly bundling, assert that the input directory can be found.
    const distRoot = await resolveInputDirectoryAsync(inputDir, { skipBundler });

    const assetSpinner = ora().start('Uploading...');
    let unsortedUpdateInfoGroups: UpdateInfoGroup = {};
    let uploadedAssetCount = 0;
    let assetLimitPerUpdateGroup = 0;
    let realizedPlatforms: PublishPlatform[] = [];

    try {
      const collectedAssets = await collectAssetsAsync(distRoot);
      const assets = filterExportedPlatformsByFlag(collectedAssets, platformFlag);
      realizedPlatforms = Object.keys(assets) as PublishPlatform[];

      // Timeout mechanism:
      // - Start with 60 second timeout. 60 seconds is chosen because the cloud function that processes
      //   uploaded assets has a timeout of 60 seconds.
      // - Each time one or more assets reports as ready, reset the timeout to 60 seconds.
      // - Start upload. Internally, uploadAssetsAsync uploads them all and then checks for successful
      //   processing every (5 + n) seconds with a linear backoff of n + 1 second.
      // - At the same time as upload is started, start timeout checker which checks every 1 second to see
      //   if timeout has been reached. When timeout expires, send a cancellation signal to currently running
      //   upload function call to instruct it to stop uploading or checking for successful processing.
      let lastUploadedStorageKeys = new Set<string>();
      let lastAssetUploadResults: {
        asset: RawAsset & { storageKey: string };
        finished: boolean;
      }[] = [];
      let timeAtWhichToTimeout = Date.now() + 60 * 1000; // sixty seconds from now
      const cancelationToken = { isCanceledOrFinished: false };

      const uploadResults = await Promise.race([
        uploadAssetsAsync(
          graphqlClient,
          assets,
          projectId,
          cancelationToken,
          assetUploadResults => {
            const currentUploadedStorageKeys = new Set(
              assetUploadResults.filter(r => r.finished).map(r => r.asset.storageKey)
            );
            if (!areSetsEqual(currentUploadedStorageKeys, lastUploadedStorageKeys)) {
              timeAtWhichToTimeout = Date.now() + 60 * 1000; // reset timeout to sixty seconds from now
              lastUploadedStorageKeys = currentUploadedStorageKeys;
              lastAssetUploadResults = assetUploadResults;
            }

            const totalAssets = assetUploadResults.length;
            const missingAssetCount = assetUploadResults.filter(a => !a.finished).length;
            assetSpinner.text = `Uploading (${totalAssets - missingAssetCount}/${totalAssets})`;
          }
        ),
        (async () => {
          while (Date.now() < timeAtWhichToTimeout) {
            if (cancelationToken.isCanceledOrFinished) {
              break;
            }
            await new Promise(res => setTimeout(res, 1000)); // wait 1 second
          }
          cancelationToken.isCanceledOrFinished = true;
          const timedOutAssets = lastAssetUploadResults
            .filter(r => !r.finished)
            .map(r => `\n- ${r.asset.originalPath ?? r.asset.path}`);
          throw new Error(`Asset processing timed out for assets: ${timedOutAssets}`);
        })(),
      ]);

      uploadedAssetCount = uploadResults.uniqueUploadedAssetCount;
      assetLimitPerUpdateGroup = uploadResults.assetLimitPerUpdateGroup;
      unsortedUpdateInfoGroups = await buildUnsortedUpdateInfoGroupAsync(assets, exp);

      // NOTE(cedric): we assume that bundles are always uploaded, and always are part of
      // `uploadedAssetCount`, perferably we don't assume. For that, we need to refactor the
      // `uploadAssetsAsync` and be able to determine asset type from the uploaded assets.
      const uploadedBundleCount = uploadResults.launchAssetCount;
      const uploadedNormalAssetCount = Math.max(0, uploadedAssetCount - uploadedBundleCount);
      const reusedNormalAssetCount = uploadResults.uniqueAssetCount - uploadedNormalAssetCount;

      assetSpinner.stop();
      Log.withTick(
        `Uploaded ${uploadedBundleCount} app ${uploadedBundleCount === 1 ? 'bundle' : 'bundles'}`
      );
      if (uploadedNormalAssetCount === 0) {
        Log.withTick(`Uploading assets skipped - no new assets found`);
      } else {
        let message = `Uploaded ${uploadedNormalAssetCount} ${
          uploadedNormalAssetCount === 1 ? 'asset' : 'assets'
        }`;
        if (reusedNormalAssetCount > 0) {
          message += ` (reused ${reusedNormalAssetCount} ${
            reusedNormalAssetCount === 1 ? 'asset' : 'assets'
          })`;
        }
        Log.withTick(message);
      }
      for (const uploadedAssetPath of uploadResults.uniqueUploadedAssetPaths) {
        Log.debug(chalk.dim(`- ${uploadedAssetPath}`));
      }

      const platformString = (Object.keys(assets) as PublishPlatform[])
        .map(platform => {
          const collectedAssetForPlatform = nullthrows(assets[platform]);
          const totalAssetsForPlatform = collectedAssetForPlatform.assets.length + 1; // launch asset
          const assetString = totalAssetsForPlatform === 1 ? 'asset' : 'assets';
          return `${totalAssetsForPlatform} ${platformDisplayNames[platform]} ${assetString}`;
        })
        .join(', ');
      Log.withInfo(
        `${platformString} (maximum: ${assetLimitPerUpdateGroup} total per update). ${learnMore(
          'https://expo.fyi/eas-update-asset-limits',
          { learnMoreMessage: 'Learn more about asset limits.' }
        )}`
      );
    } catch (e) {
      assetSpinner.fail('Failed to upload');
      throw e;
    }

    const runtimeVersions = await getRuntimeVersionObjectAsync(exp, realizedPlatforms, projectDir);
    const runtimeToPlatformMapping =
      getRuntimeToPlatformMappingFromRuntimeVersions(runtimeVersions);

    const { branchId, createdBranch } = await ensureBranchExistsAsync(graphqlClient, {
      appId: projectId,
      branchName,
    });
    if (createdBranch) {
      await ensureChannelExistsAsync(graphqlClient, {
        appId: projectId,
        branchId,
        channelName: branchName,
      });
      Log.withTick(
        `Channel: ${chalk.bold(branchName)} pointed at branch: ${chalk.bold(branchName)}`
      );
    }

    const vcsClient = getVcsClient();

    const gitCommitHash = await vcsClient.getCommitHashAsync();
    const isGitWorkingTreeDirty = await vcsClient.hasUncommittedChangesAsync();

    // Sort the updates into different groups based on their platform specific runtime versions
    const updateGroups: PublishUpdateGroupInput[] = runtimeToPlatformMapping.map(
      ({ runtimeVersion, platforms }) => {
        const localUpdateInfoGroup = Object.fromEntries(
          platforms.map(platform => [
            platform,
            unsortedUpdateInfoGroups[platform as keyof UpdateInfoGroup],
          ])
        );

        return {
          branchId,
          updateInfoGroup: localUpdateInfoGroup,
          runtimeVersion,
          message: updateMessage,
          gitCommitHash,
          isGitWorkingTreeDirty,
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
          const newUpdates = updatesTemp.splice(
            0,
            Object.keys(nullthrows(updateGroup.updateInfoGroup)).length
          );
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
                    nullthrows(updateGroup.updateInfoGroup)[
                      newUpdate.platform as keyof UpdateInfoGroup
                    ]
                  )
                );

                const manifestSignature = signBody(manifestBody, codeSigningInfo);

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
      printJsonOnlyOutput(getUpdateGroupJsonInfo(newUpdates));
    } else {
      if (new Set(newUpdates.map(update => update.group)).size > 1) {
        Log.addNewLineIfNone();
        Log.log(
          '👉 Since multiple runtime versions are defined, multiple update groups have been published.'
        );
      }

      Log.addNewLineIfNone();

      for (const runtime of uniqBy(runtimeVersions, version => version.runtimeVersion)) {
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
            { label: 'Message', value: updateMessage },
            ...(gitCommitHash
              ? [
                  {
                    label: 'Commit',
                    value: `${gitCommitHash}${isGitWorkingTreeDirty ? '*' : ''}`,
                  },
                ]
              : []),
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

    const { auto, branch: branchName, channel: channelName, dev, message: updateMessage } = flags;
    if (nonInteractive && !auto && !(updateMessage && (branchName || channelName))) {
      Errors.error(
        '--branch and --message, or --channel and --message are required when updating in non-interactive mode unless --auto is specified',
        { exit: 1 }
      );
    }

    if (flags.group || flags.republish) {
      // Pick the first flag set that is defined, in this specific order
      const args = [
        ['--group', flags.group],
        ['--branch', flags.branch],
      ].filter(([_, value]) => value)[0];

      Log.newLine();
      Log.warn(
        'The --group and --republish flags are deprecated, use the republish command instead:'
      );
      Log.warn(`  ${chalk.bold([`eas update:republish`, ...(args ?? [])].join(' '))}`);
      Log.newLine();

      Errors.error('--group and --republish flags are deprecated', { exit: 1 });
    }

    return {
      auto,
      branchName,
      channelName,
      dev,
      updateMessage,
      inputDir: flags['input-dir'],
      skipBundler: flags['skip-bundler'],
      clearCache: flags['clear-cache'],
      platform: flags.platform as RequestedPlatform,
      privateKeyPath: flags['private-key-path'],
      nonInteractive,
      json: flags.json ?? false,
    };
  }
}
