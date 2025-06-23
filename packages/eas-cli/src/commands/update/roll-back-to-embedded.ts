import { EasJson, EasJsonAccessor, EasJsonUtils } from '@expo/eas-json';
import { Errors, Flags } from '@oclif/core';

import { ensureBranchExistsAsync } from '../../branch/queries';
import EasCommand from '../../commandUtils/EasCommand';
import { EasNonInteractiveAndJsonFlags } from '../../commandUtils/flags';
import { getPaginatedQueryOptions } from '../../commandUtils/pagination';
import { StatuspageServiceName } from '../../graphql/generated';
import { RequestedPlatform } from '../../platform';
import { enforceRollBackToEmbeddedUpdateSupportAsync } from '../../project/projectUtils';
import {
  UpdatePublishPlatform,
  defaultPublishPlatforms,
  getBranchNameForCommandAsync,
  getUpdateMessageForCommandAsync,
} from '../../project/publish';
import { ensureEASUpdateIsConfiguredAsync } from '../../update/configure';
import { selectRuntimeOnBranchAsync } from '../../update/queries';
import { publishRollBackToEmbeddedUpdateAsync } from '../../update/roll-back-to-embedded';
import { getCodeSigningInfoAsync } from '../../utils/code-signing';
import { enableJsonOutput } from '../../utils/json';
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

    const easJsonAccessor = EasJsonAccessor.fromProjectPath(projectDir);
    const easJsonCliConfig: EasJson['cli'] =
      (await EasJsonUtils.getCliConfigAsync(easJsonAccessor)) ?? {};

    await ensureEASUpdateIsConfiguredAsync({
      exp: expPossiblyWithoutEasUpdateConfigured,
      platform: platformFlag,
      projectDir,
      projectId,
      vcsClient,
      env: undefined,
      manifestHostOverride: easJsonCliConfig.updateManifestHostOverride ?? null,
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
        await selectRuntimeOnBranchAsync(graphqlClient, {
          appId: projectId,
          branchName,
        })
      )?.version;
    if (!selectedRuntime) {
      Errors.error('Must select a runtime or provide the --runtimeVersion flag', { exit: 1 });
    }

    await publishRollBackToEmbeddedUpdateAsync({
      graphqlClient,
      projectId,
      exp,
      updateMessage,
      branch,
      codeSigningInfo,
      platforms: realizedPlatforms,
      runtimeVersion: selectedRuntime,
      json: jsonFlag,
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
