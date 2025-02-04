import { Workflow } from '@expo/eas-build-job';
import { Errors, Flags } from '@oclif/core';
import chalk from 'chalk';
import nullthrows from 'nullthrows';

import { ensureBranchExistsAsync } from '../../branch/queries';
import { transformFingerprintSource } from '../../build/graphql';
import { ensureRepoIsCleanAsync } from '../../build/utils/repository';
import { getUpdateGroupUrl } from '../../build/utils/url';
import EasCommand from '../../commandUtils/EasCommand';
import { EasNonInteractiveAndJsonFlags, EasUpdateEnvironmentFlag } from '../../commandUtils/flags';
import { getPaginatedQueryOptions } from '../../commandUtils/pagination';
import fetch from '../../fetch';
import {
  EnvironmentVariableEnvironment,
  FingerprintInfoGroup,
  PublishUpdateGroupInput,
  StatuspageServiceName,
  UpdateInfoGroup,
  UpdatePublishMutation,
  UpdateRolloutInfoGroup,
} from '../../graphql/generated';
import { PublishMutation } from '../../graphql/mutations/PublishMutation';
import Log, { learnMore, link } from '../../log';
import { ora } from '../../ora';
import { RequestedPlatform } from '../../platform';
import { maybeUploadFingerprintAsync } from '../../project/maybeUploadFingerprintAsync';
import { getOwnerAccountForProjectIdAsync } from '../../project/projectUtils';
import {
  RawAsset,
  UpdatePublishPlatform,
  buildBundlesAsync,
  buildUnsortedUpdateInfoGroupAsync,
  collectAssetsAsync,
  filterCollectedAssetsByRequestedPlatforms,
  generateEasMetadataAsync,
  getBranchNameForCommandAsync,
  getRuntimeToPlatformsAndFingerprintInfoMappingFromRuntimeVersionInfoObjects,
  getRuntimeToUpdateRolloutInfoGroupMappingAsync,
  getRuntimeVersionInfoObjectsAsync,
  getUpdateMessageForCommandAsync,
  isUploadedAssetCountAboveWarningThreshold,
  maybeCalculateFingerprintForRuntimeVersionInfoObjectsWithoutExpoUpdatesAsync,
  platformDisplayNames,
  resolveInputDirectoryAsync,
  uploadAssetsAsync,
} from '../../project/publish';
import { resolveWorkflowPerPlatformAsync } from '../../project/workflow';
import { ensureEASUpdateIsConfiguredAsync } from '../../update/configure';
import { getUpdateJsonInfosForUpdates } from '../../update/utils';
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

type RawUpdateFlags = {
  auto: boolean;
  branch?: string;
  channel?: string;
  message?: string;
  platform: RequestedPlatform;
  'input-dir': string;
  'skip-bundler': boolean;
  'clear-cache': boolean;
  'private-key-path'?: string;
  'emit-metadata': boolean;
  'rollout-percentage'?: number;
  'non-interactive': boolean;
  json: boolean;
  environment: EnvironmentVariableEnvironment | null;
};

type UpdateFlags = {
  auto: boolean;
  platform: RequestedPlatform;
  branchName?: string;
  channelName?: string;
  updateMessage?: string;
  inputDir: string;
  skipBundler: boolean;
  clearCache: boolean;
  privateKeyPath?: string;
  emitMetadata: boolean;
  rolloutPercentage?: number;
  json: boolean;
  nonInteractive: boolean;
  environment: EnvironmentVariableEnvironment | null;
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
    'emit-metadata': Flags.boolean({
      description: `Emit "eas-update-metadata.json" in the bundle folder with detailed information about the generated updates`,
      default: false,
    }),
    'rollout-percentage': Flags.integer({
      description: `Percentage of users this update should be immediately available to. Users not in the rollout will be served the previous latest update on the branch, even if that update is itself being rolled out. The specified number must be an integer between 1 and 100. When not specified, this defaults to 100.`,
      required: false,
      min: 0,
      max: 100,
    }),
    platform: Flags.enum<RequestedPlatform>({
      char: 'p',
      options: Object.values(RequestedPlatform), // TODO: Add web when it's fully supported
      default: RequestedPlatform.All,
      required: false,
    }),
    auto: Flags.boolean({
      description:
        'Use the current git branch and commit message for the EAS branch and update message',
      default: false,
    }),
    'private-key-path': Flags.string({
      description: `File containing the PEM-encoded private key corresponding to the certificate in expo-updates' configuration. Defaults to a file named "private-key.pem" in the certificate's directory. Only relevant if you are using code signing: https://docs.expo.dev/eas-update/code-signing/`,
      required: false,
    }),
    ...EasUpdateEnvironmentFlag,
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.DynamicProjectConfig,
    ...this.ContextOptions.LoggedIn,
    ...this.ContextOptions.Vcs,
    ...this.ContextOptions.ServerSideEnvironmentVariables,
  };

  async runAsync(): Promise<void> {
    const { flags: rawFlags } = await this.parse(UpdatePublish);
    const paginatedQueryOptions = getPaginatedQueryOptions(rawFlags);
    const {
      auto: autoFlag,
      platform: requestedPlatform,
      channelName: channelNameArg,
      updateMessage: updateMessageArg,
      inputDir,
      skipBundler,
      clearCache,
      privateKeyPath,
      json: jsonFlag,
      nonInteractive,
      branchName: branchNameArg,
      emitMetadata,
      rolloutPercentage,
      environment,
    } = this.sanitizeFlags(rawFlags);

    const {
      getDynamicPublicProjectConfigAsync,
      getDynamicPrivateProjectConfigAsync,
      loggedIn: { graphqlClient },
      vcsClient,
      getServerSideEnvironmentVariablesAsync,
    } = await this.getContextAsync(UpdatePublish, {
      nonInteractive,
      withServerSideEnvironment: environment,
    });

    if (jsonFlag) {
      enableJsonOutput();
    }

    await vcsClient.ensureRepoExistsAsync();
    await ensureRepoIsCleanAsync(vcsClient, nonInteractive);

    const {
      exp: expPossiblyWithoutEasUpdateConfigured,
      projectId,
      projectDir,
    } = await getDynamicPublicProjectConfigAsync();

    await maybeWarnAboutEasOutagesAsync(graphqlClient, [StatuspageServiceName.EasUpdate]);

    await ensureEASUpdateIsConfiguredAsync({
      exp: expPossiblyWithoutEasUpdateConfigured,
      platform: requestedPlatform,
      projectDir,
      projectId,
      vcsClient,
      env: undefined,
    });

    const { exp } = await getDynamicPublicProjectConfigAsync();
    const { exp: expPrivate } = await getDynamicPrivateProjectConfigAsync();
    const codeSigningInfo = await getCodeSigningInfoAsync(expPrivate, privateKeyPath);

    const branchName = await getBranchNameForCommandAsync({
      graphqlClient,
      vcsClient,
      projectId,
      channelNameArg,
      branchNameArg,
      autoFlag,
      nonInteractive,
      paginatedQueryOptions,
    });

    const updateMessage = await getUpdateMessageForCommandAsync(vcsClient, {
      updateMessageArg,
      autoFlag,
      nonInteractive,
      jsonFlag,
    });

    const maybeServerEnv = environment
      ? { ...(await getServerSideEnvironmentVariablesAsync()), EXPO_NO_DOTENV: '1' }
      : {};

    // build bundle and upload assets for a new publish
    if (!skipBundler) {
      const bundleSpinner = ora().start('Exporting...');
      try {
        await buildBundlesAsync({
          projectDir,
          inputDir,
          exp,
          platformFlag: requestedPlatform,
          clearCache,
          extraEnv: maybeServerEnv,
        });
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
    let realizedPlatforms: UpdatePublishPlatform[] = [];

    try {
      const collectedAssets = await collectAssetsAsync(distRoot);
      const assets = filterCollectedAssetsByRequestedPlatforms(collectedAssets, requestedPlatform);
      realizedPlatforms = Object.keys(assets) as UpdatePublishPlatform[];

      // Timeout mechanism:
      // - Start with NO_ACTIVITY_TIMEOUT. 180 seconds is chosen because the cloud function that processes
      //   uploaded assets has a timeout of 60 seconds and uploading can take some time on a slow connection.
      // - Each time one or more assets reports as ready, reset the timeout.
      // - Each time an asset upload begins, reset the timeout. This includes retries.
      // - Start upload. Internally, uploadAssetsAsync uploads them all first and then checks for successful
      //   processing every (5 + n) seconds with a linear backoff of n + 1 second.
      // - At the same time as upload is started, start timeout checker which checks every 1 second to see
      //   if timeout has been reached. When timeout expires, send a cancellation signal to currently running
      //   upload function call to instruct it to stop uploading or checking for successful processing.
      const NO_ACTIVITY_TIMEOUT = 180 * 1000; // 180 seconds
      let lastUploadedStorageKeys = new Set<string>();
      let lastAssetUploadResults: {
        asset: RawAsset & { storageKey: string };
        finished: boolean;
      }[] = [];
      let timeAtWhichToTimeout = Date.now() + NO_ACTIVITY_TIMEOUT;
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
              timeAtWhichToTimeout = Date.now() + NO_ACTIVITY_TIMEOUT; // reset timeout to NO_ACTIVITY_TIMEOUT
              lastUploadedStorageKeys = currentUploadedStorageKeys;
              lastAssetUploadResults = assetUploadResults;
            }

            const totalAssets = assetUploadResults.length;
            const missingAssetCount = assetUploadResults.filter(a => !a.finished).length;
            assetSpinner.text = `Uploading (${totalAssets - missingAssetCount}/${totalAssets})`;
          },
          () => {
            // when an upload is retried, reset the timeout as we know this will now need more time
            timeAtWhichToTimeout = Date.now() + NO_ACTIVITY_TIMEOUT; // reset timeout to NO_ACTIVITY_TIMEOUT
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

      const platformString = realizedPlatforms
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
          { learnMoreMessage: 'Learn more about asset limits' }
        )}`
      );
    } catch (e) {
      assetSpinner.fail('Failed to upload');
      throw e;
    }

    const workflows = await resolveWorkflowPerPlatformAsync(projectDir, vcsClient);
    const runtimeVersionInfoObjects = await getRuntimeVersionInfoObjectsAsync({
      exp,
      platforms: realizedPlatforms,
      projectDir,
      workflows: {
        ...workflows,
        web: Workflow.UNKNOWN,
      },
      env: maybeServerEnv,
    });
    const runtimeToPlatformsAndFingerprintInfoMapping =
      getRuntimeToPlatformsAndFingerprintInfoMappingFromRuntimeVersionInfoObjects(
        runtimeVersionInfoObjects
      );

    const { branch } = await ensureBranchExistsAsync(graphqlClient, {
      appId: projectId,
      branchName,
    });

    const runtimeToPlatformsAndFingerprintInfoAndFingerprintSourceMappingFromExpoUpdates =
      await Promise.all(
        runtimeToPlatformsAndFingerprintInfoMapping.map(async info => {
          return {
            ...info,
            expoUpdatesRuntimeFingerprintSource: info.expoUpdatesRuntimeFingerprint
              ? (
                  await maybeUploadFingerprintAsync({
                    hash: info.runtimeVersion,
                    fingerprint: info.expoUpdatesRuntimeFingerprint,
                    graphqlClient,
                  })
                ).fingerprintSource ?? null
              : null,
          };
        })
      );

    const runtimeToPlatformsAndFingerprintInfoAndFingerprintSourceMapping =
      await maybeCalculateFingerprintForRuntimeVersionInfoObjectsWithoutExpoUpdatesAsync({
        projectDir,
        graphqlClient,
        runtimeToPlatformsAndFingerprintInfoAndFingerprintSourceMapping:
          runtimeToPlatformsAndFingerprintInfoAndFingerprintSourceMappingFromExpoUpdates,
        workflowsByPlatform: workflows,
        env: undefined,
      });

    const runtimeVersionToRolloutInfoGroup =
      rolloutPercentage !== undefined
        ? await getRuntimeToUpdateRolloutInfoGroupMappingAsync(graphqlClient, {
            appId: projectId,
            branchName,
            rolloutPercentage,
            runtimeToPlatformsAndFingerprintInfoMapping,
          })
        : undefined;

    const gitCommitHash = await vcsClient.getCommitHashAsync();
    const isGitWorkingTreeDirty = await vcsClient.hasUncommittedChangesAsync();

    // Sort the updates into different groups based on their platform specific runtime versions
    const updateGroups: PublishUpdateGroupInput[] =
      runtimeToPlatformsAndFingerprintInfoAndFingerprintSourceMapping.map(
        ({ runtimeVersion, platforms, fingerprintInfoGroup }) => {
          const localUpdateInfoGroup = Object.fromEntries(
            platforms.map(platform => [
              platform,
              unsortedUpdateInfoGroups[platform as keyof UpdateInfoGroup],
            ])
          );

          const rolloutInfoGroupForRuntimeVersion = runtimeVersionToRolloutInfoGroup
            ? runtimeVersionToRolloutInfoGroup.get(runtimeVersion)
            : null;
          const localRolloutInfoGroup = rolloutInfoGroupForRuntimeVersion
            ? Object.fromEntries(
                platforms.map(platform => [
                  platform,
                  rolloutInfoGroupForRuntimeVersion[platform as keyof UpdateRolloutInfoGroup],
                ])
              )
            : null;
          const transformedFingerprintInfoGroup = Object.entries(fingerprintInfoGroup).reduce(
            (prev, [platform, fingerprintInfo]) => {
              return {
                ...prev,
                [platform]: {
                  ...fingerprintInfo,
                  fingerprintSource: transformFingerprintSource(fingerprintInfo.fingerprintSource),
                },
              };
            },
            {} as FingerprintInfoGroup
          );

          return {
            branchId: branch.id,
            updateInfoGroup: localUpdateInfoGroup,
            rolloutInfoGroup: localRolloutInfoGroup,
            fingerprintInfoGroup: transformedFingerprintInfoGroup,
            runtimeVersion,
            message: updateMessage,
            gitCommitHash,
            isGitWorkingTreeDirty,
            awaitingCodeSigningInfo: !!codeSigningInfo,
            environment: environment ?? null,
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

    if (!skipBundler && emitMetadata) {
      Log.log('Generating eas-update-metadata.json');
      await generateEasMetadataAsync(distRoot, getUpdateJsonInfosForUpdates(newUpdates));
    }
    if (jsonFlag) {
      printJsonOnlyOutput(getUpdateJsonInfosForUpdates(newUpdates));
    } else {
      if (new Set(newUpdates.map(update => update.group)).size > 1) {
        Log.addNewLineIfNone();
        Log.log(
          '👉 Since multiple runtime versions are defined, multiple update groups have been published.'
        );
      }

      Log.addNewLineIfNone();

      for (const runtime of uniqBy(
        runtimeToPlatformsAndFingerprintInfoMapping,
        version => version.runtimeVersion
      )) {
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
            ...(newAndroidUpdate?.rolloutControlUpdate
              ? [
                  {
                    label: 'Android Rollout',
                    value: `${newAndroidUpdate.rolloutPercentage}% (Base update ID: ${newAndroidUpdate.rolloutControlUpdate.id})`,
                  },
                ]
              : []),
            ...(newIosUpdate?.rolloutControlUpdate
              ? [
                  {
                    label: 'iOS Rollout',
                    value: `${newIosUpdate.rolloutPercentage}% (Base update ID: ${newIosUpdate.rolloutControlUpdate.id})`,
                  },
                ]
              : []),
            { label: 'Message', value: updateMessage ?? '' },
            ...(gitCommitHash
              ? [
                  {
                    label: 'Commit',
                    value: `${gitCommitHash}${isGitWorkingTreeDirty ? '*' : ''}`,
                  },
                ]
              : []),
            { label: 'EAS Dashboard', value: updateGroupLink },
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

    const { auto, branch: branchName, channel: channelName, message: updateMessage } = flags;
    if (nonInteractive && !auto && !(updateMessage && (branchName || channelName))) {
      Errors.error(
        '--branch and --message, or --channel and --message are required when updating in non-interactive mode unless --auto is specified',
        { exit: 1 }
      );
    }

    const skipBundler = flags['skip-bundler'] ?? false;
    let emitMetadata = flags['emit-metadata'] ?? false;

    if (skipBundler && emitMetadata) {
      emitMetadata = false;
      Log.warn(
        'ignoring flag --emit-metadata as metadata cannot be generated when skipping bundle generation'
      );
    }

    return {
      auto,
      branchName,
      channelName,
      updateMessage,
      inputDir: flags['input-dir'],
      skipBundler,
      clearCache: flags['clear-cache'] ? true : !!flags['environment'],
      platform: flags.platform,
      privateKeyPath: flags['private-key-path'],
      rolloutPercentage: flags['rollout-percentage'],
      nonInteractive,
      emitMetadata,
      json: flags.json ?? false,
      environment: flags['environment'],
    };
  }
}
