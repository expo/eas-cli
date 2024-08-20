import { Platform as PublishPlatform } from '@expo/config';
import { Workflow } from '@expo/eas-build-job';
import { Errors, Flags } from '@oclif/core';
import nullthrows from 'nullthrows';

import { ensureBranchExistsAsync } from '../../branch/queries';
import { getUpdateGroupUrl } from '../../build/utils/url';
import EasCommand from '../../commandUtils/EasCommand';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { EasNonInteractiveAndJsonFlags } from '../../commandUtils/flags';
import { getPaginatedQueryOptions } from '../../commandUtils/pagination';
import fetch from '../../fetch';
import {
  PublishUpdateGroupInput,
  StatuspageServiceName,
  UpdatePublishMutation,
} from '../../graphql/generated';
import { PublishMutation } from '../../graphql/mutations/PublishMutation';
import Log, { link } from '../../log';
import { ora } from '../../ora';
import { RequestedPlatform } from '../../platform';
import {
  enforceRollBackToEmbeddedUpdateSupportAsync,
  getOwnerAccountForProjectIdAsync,
} from '../../project/projectUtils';
import {
  ExpoCLIExportPlatformFlag,
  defaultPublishPlatforms,
  getBranchNameForCommandAsync,
  getRequestedPlatform,
  getRuntimeToPlatformMappingFromRuntimeVersions,
  getRuntimeVersionObjectAsync,
  getUpdateMessageForCommandAsync,
} from '../../project/publish';
import { resolveWorkflowPerPlatformAsync } from '../../project/workflow';
import { ensureEASUpdateIsConfiguredAsync } from '../../update/configure';
import { getUpdateJsonInfosForUpdates } from '../../update/utils';
import {
  CodeSigningInfo,
  checkDirectiveBodyAgainstUpdateInfoGroup,
  getCodeSigningInfoAsync,
  getDirectiveBodyAsync,
  signBody,
} from '../../utils/code-signing';
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
  'private-key-path'?: string;
  'non-interactive': boolean;
  json: boolean;
};

type UpdateFlags = {
  auto: boolean;
  platform: ExpoCLIExportPlatformFlag;
  branchName?: string;
  channelName?: string;
  updateMessage?: string;
  privateKeyPath?: string;
  json: boolean;
  nonInteractive: boolean;
};

export default class UpdateRollBackToEmbedded extends EasCommand {
  static override description = 'roll back to the embedded update';

  static override flags = {
    branch: Flags.string({
      description: 'Branch to publish the rollback to embedded update group on',
      required: false,
    }),
    channel: Flags.string({
      description: 'Channel that the published rollback to embedded update should affect',
      required: false,
    }),
    message: Flags.string({
      description: 'A short message describing the rollback to embedded update',
      required: false,
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
    const { flags: rawFlags } = await this.parse(UpdateRollBackToEmbedded);
    const paginatedQueryOptions = getPaginatedQueryOptions(rawFlags);
    const {
      auto: autoFlag,
      platform: platformFlag,
      channelName: channelNameArg,
      updateMessage: updateMessageArg,
      privateKeyPath,
      json: jsonFlag,
      nonInteractive,
      branchName: branchNameArg,
    } = this.sanitizeFlags(rawFlags);

    const {
      getDynamicPublicProjectConfigAsync,
      getDynamicPrivateProjectConfigAsync,
      loggedIn: { graphqlClient },
      vcsClient,
    } = await this.getContextAsync(UpdateRollBackToEmbedded, {
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

    await ensureEASUpdateIsConfiguredAsync({
      exp: expPossiblyWithoutEasUpdateConfigured,
      platform: getRequestedPlatform(platformFlag),
      projectDir,
      projectId,
      vcsClient,
      env: undefined,
    });

    // check that the expo-updates package version supports roll back to embedded
    await enforceRollBackToEmbeddedUpdateSupportAsync(projectDir);

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

    const realizedPlatforms: PublishPlatform[] =
      platformFlag === 'all' ? defaultPublishPlatforms : [platformFlag];

    const { branchId } = await ensureBranchExistsAsync(graphqlClient, {
      appId: projectId,
      branchName,
    });

    const gitCommitHash = await vcsClient.getCommitHashAsync();
    const isGitWorkingTreeDirty = await vcsClient.hasUncommittedChangesAsync();

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

    let newUpdates: UpdatePublishMutation['updateBranch']['publishUpdateGroups'];
    const publishSpinner = ora('Publishing...').start();
    try {
      newUpdates = await this.publishRollbacksAsync({
        graphqlClient,
        isGitWorkingTreeDirty,
        gitCommitHash,
        updateMessage,
        branchId,
        codeSigningInfo,
        runtimeVersions,
        realizedPlatforms,
      });
      publishSpinner.succeed('Published!');
    } catch (e) {
      publishSpinner.fail('Failed to publish updates');
      throw e;
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
      }
    }
  }

  private async publishRollbacksAsync({
    graphqlClient,
    isGitWorkingTreeDirty,
    gitCommitHash,
    updateMessage,
    branchId,
    codeSigningInfo,
    runtimeVersions,
    realizedPlatforms,
  }: {
    graphqlClient: ExpoGraphqlClient;
    isGitWorkingTreeDirty: boolean | undefined;
    gitCommitHash: string | undefined;
    updateMessage: string | undefined;
    branchId: string;
    codeSigningInfo: CodeSigningInfo | undefined;
    runtimeVersions: { platform: string; runtimeVersion: string }[];
    realizedPlatforms: PublishPlatform[];
  }): Promise<UpdatePublishMutation['updateBranch']['publishUpdateGroups']> {
    const runtimeToPlatformMapping =
      getRuntimeToPlatformMappingFromRuntimeVersions(runtimeVersions);
    const rollbackInfoGroups = Object.fromEntries(
      realizedPlatforms.map(platform => [platform, true])
    );

    // Sort the updates into different groups based on their platform specific runtime versions
    const updateGroups: PublishUpdateGroupInput[] = runtimeToPlatformMapping.map(
      ({ runtimeVersion, platforms }) => {
        const localRollbackInfoGroup = Object.fromEntries(
          platforms.map(platform => [platform, rollbackInfoGroups[platform]])
        );

        return {
          branchId,
          rollBackToEmbeddedInfoGroup: localRollbackInfoGroup,
          runtimeVersion,
          message: updateMessage,
          gitCommitHash,
          isGitWorkingTreeDirty,
          awaitingCodeSigningInfo: !!codeSigningInfo,
        };
      }
    );

    const newUpdates = await PublishMutation.publishUpdateGroupAsync(graphqlClient, updateGroups);

    if (codeSigningInfo) {
      Log.log('🔒 Signing roll back');

      const updatesTemp = [...newUpdates];
      const updateGroupsAndTheirUpdates = updateGroups.map(updateGroup => {
        const newUpdates = updatesTemp.splice(
          0,
          Object.keys(nullthrows(updateGroup.rollBackToEmbeddedInfoGroup)).length
        );
        return {
          updateGroup,
          newUpdates,
        };
      });

      await Promise.all(
        updateGroupsAndTheirUpdates.map(async ({ newUpdates }) => {
          await Promise.all(
            newUpdates.map(async newUpdate => {
              const response = await fetch(newUpdate.manifestPermalink, {
                method: 'GET',
                headers: { accept: 'multipart/mixed' },
              });
              const directiveBody = nullthrows(await getDirectiveBodyAsync(response));

              checkDirectiveBodyAgainstUpdateInfoGroup(directiveBody);

              const directiveSignature = signBody(directiveBody, codeSigningInfo);

              await PublishMutation.setCodeSigningInfoAsync(graphqlClient, newUpdate.id, {
                alg: codeSigningInfo.codeSigningMetadata.alg,
                keyid: codeSigningInfo.codeSigningMetadata.keyid,
                sig: directiveSignature,
              });
            })
          );
        })
      );
    }

    return newUpdates;
  }

  private sanitizeFlags(flags: RawUpdateFlags): UpdateFlags {
    const nonInteractive = flags['non-interactive'] ?? false;

    const { auto, branch: branchName, channel: channelName, message: updateMessage } = flags;
    if (nonInteractive && !auto && !(updateMessage && (branchName ?? channelName))) {
      Errors.error(
        '--branch and --message, or --channel and --message are required when updating in non-interactive mode unless --auto is specified',
        { exit: 1 }
      );
    }

    return {
      auto,
      branchName,
      channelName,
      updateMessage,
      platform: flags.platform as RequestedPlatform,
      privateKeyPath: flags['private-key-path'],
      nonInteractive,
      json: flags.json ?? false,
    };
  }
}
