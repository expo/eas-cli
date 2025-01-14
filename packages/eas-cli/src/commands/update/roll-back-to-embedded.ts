import { Platform as PublishPlatform } from '@expo/config';
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
  RuntimeFragment,
  StatuspageServiceName,
  UpdatePublishMutation,
} from '../../graphql/generated';
import { PublishMutation } from '../../graphql/mutations/PublishMutation';
import { RuntimeQuery } from '../../graphql/queries/RuntimeQuery';
import Log, { link } from '../../log';
import { ora } from '../../ora';
import { RequestedPlatform } from '../../platform';
import {
  enforceRollBackToEmbeddedUpdateSupportAsync,
  getOwnerAccountForProjectIdAsync,
} from '../../project/projectUtils';
import {
  RuntimeVersionInfo,
  UpdatePublishPlatform,
  defaultPublishPlatforms,
  getBranchNameForCommandAsync,
  getRuntimeToPlatformsAndFingerprintInfoMappingFromRuntimeVersionInfoObjects,
  getUpdateMessageForCommandAsync,
} from '../../project/publish';
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
import { Connection, QueryParams, selectPaginatedAsync } from '../../utils/relay';
import { maybeWarnAboutEasOutagesAsync } from '../../utils/statuspageService';

type RawUpdateFlags = {
  branch?: string;
  channel?: string;
  'runtime-version'?: string;
  message?: string;
  platform: string;
  'private-key-path'?: string;
  'non-interactive': boolean;
  json: boolean;
};

type UpdateFlags = {
  platform: RequestedPlatform;
  branchName?: string;
  channelName?: string;
  runtimeVersion?: string;
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
    'runtime-version': Flags.string({
      description: 'Runtime version that the rollback to embedded update should target',
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
      platform: platformFlag,
      channelName: channelNameArg,
      updateMessage: updateMessageArg,
      runtimeVersion: runtimeVersionArg,
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
      withServerSideEnvironment: null,
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
      platform: platformFlag,
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
      autoFlag: false,
      nonInteractive,
      paginatedQueryOptions,
    });

    const updateMessage = await getUpdateMessageForCommandAsync(vcsClient, {
      updateMessageArg,
      autoFlag: false,
      nonInteractive,
      jsonFlag,
    });

    const realizedPlatforms: UpdatePublishPlatform[] =
      platformFlag === 'all' ? defaultPublishPlatforms : [platformFlag];

    const { branch } = await ensureBranchExistsAsync(graphqlClient, {
      appId: projectId,
      branchName,
    });

    const selectedRuntime =
      runtimeVersionArg ??
      (
        await UpdateRollBackToEmbedded.selectRuntimeAsync(graphqlClient, {
          appId: projectId,
          branchName,
        })
      )?.version;
    if (!selectedRuntime) {
      Errors.error('Must select a runtime or provide the --runtimeVersion flag', { exit: 1 });
    }

    const runtimeToPlatformsAndFingerprintInfoMapping =
      getRuntimeToPlatformsAndFingerprintInfoMappingFromRuntimeVersionInfoObjects(
        realizedPlatforms.map(platform => ({
          platform,
          runtimeVersionInfo: {
            runtimeVersion: selectedRuntime,
            expoUpdatesRuntimeFingerprint: null,
            expoUpdatesRuntimeFingerprintHash: null,
          },
        }))
      );

    let newUpdates: UpdatePublishMutation['updateBranch']['publishUpdateGroups'];
    const publishSpinner = ora('Publishing...').start();
    try {
      newUpdates = await this.publishRollbacksAsync({
        graphqlClient,
        updateMessage,
        branchId: branch.id,
        codeSigningInfo,
        runtimeToPlatformsAndFingerprintInfoMapping,
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
            { label: 'Message', value: updateMessage ?? '' },
            { label: 'EAS Dashboard', value: updateGroupLink },
          ])
        );
        Log.addNewLineIfNone();
      }
    }
  }

  private async publishRollbacksAsync({
    graphqlClient,
    updateMessage,
    branchId,
    codeSigningInfo,
    runtimeToPlatformsAndFingerprintInfoMapping,
    realizedPlatforms,
  }: {
    graphqlClient: ExpoGraphqlClient;
    updateMessage: string | undefined;
    branchId: string;
    codeSigningInfo: CodeSigningInfo | undefined;
    runtimeToPlatformsAndFingerprintInfoMapping: (RuntimeVersionInfo & {
      platforms: UpdatePublishPlatform[];
    })[];
    realizedPlatforms: PublishPlatform[];
  }): Promise<UpdatePublishMutation['updateBranch']['publishUpdateGroups']> {
    const rollbackInfoGroups = Object.fromEntries(
      realizedPlatforms.map(platform => [platform, true])
    );

    // Sort the updates into different groups based on their platform specific runtime versions
    const updateGroups: PublishUpdateGroupInput[] = runtimeToPlatformsAndFingerprintInfoMapping.map(
      ({ runtimeVersion, platforms }) => {
        const localRollbackInfoGroup = Object.fromEntries(
          platforms.map(platform => [platform, rollbackInfoGroups[platform]])
        );

        return {
          branchId,
          rollBackToEmbeddedInfoGroup: localRollbackInfoGroup,
          runtimeVersion,
          message: updateMessage,
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

  private static async selectRuntimeAsync(
    graphqlClient: ExpoGraphqlClient,
    {
      appId,
      branchName,
      batchSize = 5,
    }: {
      appId: string;
      branchName: string;
      batchSize?: number;
    }
  ): Promise<RuntimeFragment | null> {
    const queryAsync = async (queryParams: QueryParams): Promise<Connection<RuntimeFragment>> => {
      return await RuntimeQuery.getRuntimesOnBranchAsync(graphqlClient, {
        appId,
        name: branchName,
        first: queryParams.first,
        after: queryParams.after,
        last: queryParams.last,
        before: queryParams.before,
      });
    };
    const getTitleAsync = async (runtime: RuntimeFragment): Promise<string> => {
      return runtime.version;
    };
    return await selectPaginatedAsync({
      queryAsync,
      getTitleAsync,
      printedType: 'target runtime',
      pageSize: batchSize,
    });
  }

  private sanitizeFlags(flags: RawUpdateFlags): UpdateFlags {
    const nonInteractive = flags['non-interactive'] ?? false;

    const {
      branch: branchName,
      channel: channelName,
      message: updateMessage,
      'runtime-version': runtimeVersion,
    } = flags;
    if (nonInteractive && !(updateMessage && (branchName || channelName))) {
      Errors.error(
        '--branch and --message, or --channel and --message are required in non-interactive mode',
        { exit: 1 }
      );
    }
    if (nonInteractive && !runtimeVersion) {
      Errors.error('--runtimeVersion is required in non-interactive mode', { exit: 1 });
    }

    return {
      branchName,
      channelName,
      updateMessage,
      runtimeVersion,
      platform: flags.platform as RequestedPlatform,
      privateKeyPath: flags['private-key-path'],
      nonInteractive,
      json: flags.json ?? false,
    };
  }
}
