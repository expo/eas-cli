import { Workflow } from '@expo/eas-build-job';
import { Errors, Flags } from '@oclif/core';
import chalk from 'chalk';

import { ensureBranchExistsAsync } from '../../branch/queries';
import { ensureRepoIsCleanAsync } from '../../build/utils/repository';
import { getUpdateGroupUrl } from '../../build/utils/url';
import EasCommand from '../../commandUtils/EasCommand';
import { EasNonInteractiveAndJsonFlags } from '../../commandUtils/flags';
import { getPaginatedQueryOptions } from '../../commandUtils/pagination';
import { StatuspageServiceName } from '../../graphql/generated';
import Log, { learnMore, link } from '../../log';
import { RequestedPlatform } from '../../platform';
import { getOwnerAccountForProjectIdAsync } from '../../project/projectUtils';
import {
  ExpoCLIExportPlatformFlag,
  buildAndUploadAssetsAsync,
  defaultPublishPlatforms,
  generateEasMetadataAsync,
  getBranchNameForCommandAsync,
  getRequestedPlatform,
  getRuntimeVersionObjectAsync,
  getUpdateMessageForCommandAsync,
  isUploadedAssetCountAboveWarningThreshold,
  publishUpdateGroupsAsync,
} from '../../project/publish';
import { resolveWorkflowPerPlatformAsync } from '../../project/workflow';
import { ensureEASUpdateIsConfiguredAsync } from '../../update/configure';
import { getUpdateJsonInfosForUpdates } from '../../update/utils';
import { getCodeSigningInfoAsync } from '../../utils/code-signing';
import uniqBy from '../../utils/expodash/uniqBy';
import formatFields from '../../utils/formatFields';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';
import { maybeWarnAboutEasOutagesAsync } from '../../utils/statuspageService';

type RawUpdateFlags = {
  auto: boolean;
  branch?: string;
  channel?: string;
  message?: string;
  platform: string;
  'input-dir': string;
  'skip-bundler': boolean;
  'clear-cache': boolean;
  'private-key-path'?: string;
  'non-interactive': boolean;
  'emit-metadata': boolean;
  json: boolean;
  /** @deprecated see UpdateRepublish command */
  group?: string;
  /** @deprecated see UpdateRepublish command */
  republish?: boolean;
};

type UpdateFlags = {
  auto: boolean;
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
  emitMetadata: boolean;
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
    'emit-metadata': Flags.boolean({
      description: `Emit "eas-update-metadata.json" in the bundle folder with detailed information about the generated updates`,
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
      description: `File containing the PEM-encoded private key corresponding to the certificate in expo-updates' configuration. Defaults to a file named "private-key.pem" in the certificate's directory. Only relevant if you are using code signing: https://docs.expo.dev/eas-update/code-signing/`,
      required: false,
    }),
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.DynamicProjectConfig,
    ...this.ContextOptions.LoggedIn,
    ...this.ContextOptions.Vcs,
  };

  async runAsync(): Promise<void> {
    const { flags: rawFlags } = await this.parse(UpdatePublish);
    const paginatedQueryOptions = getPaginatedQueryOptions(rawFlags);
    const {
      auto: autoFlag,
      platform: platformFlag,
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
    } = this.sanitizeFlags(rawFlags);

    const {
      getDynamicPublicProjectConfigAsync,
      getDynamicPrivateProjectConfigAsync,
      loggedIn: { graphqlClient },
      vcsClient,
    } = await this.getContextAsync(UpdatePublish, {
      nonInteractive,
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
      platform: getRequestedPlatform(platformFlag),
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

    const {
      distRoot,
      realizedPlatforms,
      unsortedUpdateInfoGroups,
      uploadedAssetCount,
      assetLimitPerUpdateGroup,
    } = await buildAndUploadAssetsAsync({
      graphqlClient,
      projectId,
      skipBundler,
      projectDir,
      inputDir,
      exp,
      platformFlag,
      clearCache,
    });

    const { branchId } = await ensureBranchExistsAsync(graphqlClient, {
      appId: projectId,
      branchName,
    });

    const workflows = await resolveWorkflowPerPlatformAsync(projectDir, vcsClient);
    const runtimeVersions = await getRuntimeVersionObjectAsync({
      exp,
      platforms: realizedPlatforms,
      projectDir,
      workflows: {
        ...workflows,
        web: Workflow.UNKNOWN,
      },
      env: undefined,
    });

    const gitCommitHash = await vcsClient.getCommitHashAsync();
    const isGitWorkingTreeDirty = await vcsClient.hasUncommittedChangesAsync();

    const { newUpdates } = await publishUpdateGroupsAsync({
      graphqlClient,
      branchId,
      runtimeVersions,
      gitCommitHash,
      isGitWorkingTreeDirty,
      unsortedUpdateInfoGroups,
      updateMessage,
      codeSigningInfo,
    });

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
      clearCache: flags['clear-cache'],
      platform: flags.platform as RequestedPlatform,
      privateKeyPath: flags['private-key-path'],
      nonInteractive,
      emitMetadata,
      json: flags.json ?? false,
    };
  }
}
