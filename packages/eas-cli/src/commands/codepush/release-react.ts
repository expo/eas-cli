/**
 * $ appcenter codepush release-react --help

Release a React Native update to an app deployment

Usage: appcenter codepush release-react [--use-hermes] [--extra-hermes-flag <arg>] [--extra-bundler-option <arg>]
         [-t|--target-binary-version <arg>] [-o|--output-dir <arg>] [--sourcemap-output-dir <arg>]
         [-s|--sourcemap-output <arg>] [-xt|--xcode-target-name <arg>] [-c|--build-configuration-name <arg>]
         [--plist-file-prefix <arg>] [-xp|--xcode-project-file <arg>] [-p|--plist-file <arg>] [--pod-file <arg>]
         [-g|--gradle-file <arg>] [-e|--entry-file <arg>] [--development] [-b|--bundle-name <arg>]
         [-r|--rollout <arg>] [--disable-duplicate-release-error] [-k|--private-key-path <arg>] [-m|--mandatory]
         [-x|--disabled] [--description <arg>] [-d|--deployment-name <arg>] [-a|--app <arg>]

Options:
       --use-hermes                                  Enable hermes and bypass automatic checks
       --extra-hermes-flag <arg>                     Flag that gets passed to Hermes, JavaScript to bytecode compiler. Can
                                                     be specified multiple times
       --extra-bundler-option <arg>                  Option that gets passed to react-native bundler. Can be specified
                                                     multiple times
    -t|--target-binary-version <arg>                 Semver expression that specifies the binary app version(s) this
                                                     release is targeting (e.g. 1.1.0, ~1.2.3)
    -o|--output-dir <arg>                            Path to where the bundle should be written. If omitted, the bundle
                                                     will not be saved on your machine
       --sourcemap-output-dir <arg>                  Path to folder where the sourcemap for the resulting bundle should be
                                                     written. Name of sourcemap file will be generated automatically. This
                                                     argument will be ignored if "sourcemap-output" argument is provided.
                                                     If omitted, a sourcemap will not be generated
    -s|--sourcemap-output <arg>                      Path to where the sourcemap for the resulting bundle should be
                                                     written. If omitted, a sourcemap will not be generated
    -xt|--xcode-target-name <arg>                    Name of target (PBXNativeTarget) which specifies the binary version
                                                     you want to target this release at (iOS only)
    -c|--build-configuration-name <arg>              Name of build configuration which specifies the binary version you
                                                     want to target this release at. For example, "Debug" or "Release" (iOS
                                                     only)
       --plist-file-prefix <arg>                     Prefix to append to the file name when attempting to find your app's
                                                     Info.plist file (iOS only)
    -xp|--xcode-project-file <arg>                   Path to the Xcode project or project.pbxproj file
    -p|--plist-file <arg>                            Path to the plist file which specifies the binary version you want to
                                                     target this release at (iOS only)
       --pod-file <arg>                              Path to the cocopods config file (iOS only)
    -g|--gradle-file <arg>                           Path to the gradle file which specifies the binary version you want to
                                                     target this release at (android only)
    -e|--entry-file <arg>                            Path to the app's entry JavaScript file. If omitted,
                                                     "index.<platform>.js" and then "index.js" will be used (if they exist)
       --development                                 Specifies whether to generate a dev or release build
    -b|--bundle-name <arg>                           Name of the generated JS bundle file. If unspecified, the standard
                                                     bundle name will be used, depending on the specified platform:
                                                     "main.jsbundle" (iOS), "index.android.bundle" (Android) or
                                                     "index.windows.bundle" (Windows)
    -r|--rollout <arg>                               Percentage of users this release should be available to
       --disable-duplicate-release-error             When this flag is set, releasing a package that is identical to the
                                                     latest release will produce a warning instead of an error
    -k|--private-key-path <arg>                      Specifies the location of a RSA private key to sign the release
                                                     with.NOTICE: use it for react native applications only, client SDK on
                                                     other platforms will be ignoring signature verification for now!
    -m|--mandatory                                   Specifies whether this release should be considered mandatory
    -x|--disabled                                    Specifies whether this release should be immediately downloadable
       --description <arg>                           Description of the changes made to the app in this release
    -d|--deployment-name <arg>                       Deployment to release the update to
    -a|--app <arg>                                   Specify app in the <ownerName>/<appName> format

Common Options (works on all commands):
       --disable-telemetry             Disable telemetry for this command
    -v|--version                       Display appcenter version
       --quiet                         Auto-confirm any prompts without waiting for input
    -h|--help                          Display help for current command
       --env <arg>                     Environment when using API token
       --token <arg>                   API token
       --output <arg>                  Output format: json
       --debug                         Display extra output for debugging
 */

import { Workflow } from '@expo/eas-build-job';
import { Flags } from '@oclif/core';

import { createUpdateBranchOnAppAsync } from '../../branch/queries';
import { ensureRepoIsCleanAsync } from '../../build/utils/repository';
import { getUpdateGroupUrl } from '../../build/utils/url';
import {
  BranchMapping,
  getAlwaysTrueBranchMapping,
  getBranchMapping,
  isAlwaysTrueBranchMapping,
  isEmptyBranchMapping,
} from '../../channel/branch-mapping';
import { updateChannelBranchMappingAsync } from '../../channel/queries';
import EasCommand from '../../commandUtils/EasCommand';
import { EasNonInteractiveAndJsonFlags } from '../../commandUtils/flags';
import { StatuspageServiceName } from '../../graphql/generated';
import { ChannelQuery } from '../../graphql/queries/ChannelQuery';
import Log, { learnMore, link } from '../../log';
import { RequestedPlatform } from '../../platform';
import { getOwnerAccountForProjectIdAsync } from '../../project/projectUtils';
import {
  buildAndUploadAssetsAsync,
  getRuntimeVersionObjectAsync,
  isUploadedAssetCountAboveWarningThreshold,
  publishUpdateGroupsAsync,
} from '../../project/publish';
import { resolveWorkflowPerPlatformAsync } from '../../project/workflow';
import { createRolloutBranchMapping, isRolloutBranchMapping } from '../../rollout/branch-mapping';
import { ensureEASUpdateIsConfiguredAsync } from '../../update/configure';
import { getUpdateJsonInfosForUpdates } from '../../update/utils';
import { getCodeSigningInfoAsync } from '../../utils/code-signing';
import uniqBy from '../../utils/expodash/uniqBy';
import formatFields from '../../utils/formatFields';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';
import { maybeWarnAboutEasOutagesAsync } from '../../utils/statuspageService';

export default class CodepushReleaseReact extends EasCommand {
  static override hidden = true;
  static override description = 'Release an update to a deployment';

  static override flags = {
    rollout: Flags.integer({
      char: 'r',
      description: 'Percentage of users this release should be available to',
      required: false,
    }),
    description: Flags.string({
      description: 'Description of the changes made to the app in this release',
      required: true,
    }),
    deploymentName: Flags.string({
      char: 'd',
      description: 'Deployment to release the update to',
      required: true,
    }),
    disabled: Flags.boolean({
      char: 'x',
      description: 'Specifies whether this release should be immediately downloadable',
      required: false,
    }),
    'clear-cache': Flags.boolean({
      description: `Clear the bundler cache before publishing`,
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
    const {
      flags: {
        rollout,
        description,
        deploymentName,
        disabled,
        'clear-cache': clearCache,
        'private-key-path': privateKeyPath,
        json: jsonFlag,
        'non-interactive': nonInteractive,
      },
    } = await this.parse(CodepushReleaseReact);
    const {
      getDynamicPublicProjectConfigAsync,
      getDynamicPrivateProjectConfigAsync,
      loggedIn: { graphqlClient },
      vcsClient,
    } = await this.getContextAsync(CodepushReleaseReact, {
      nonInteractive,
    });
    if (jsonFlag) {
      enableJsonOutput();
    }

    if (!deploymentName) {
      throw new Error('Deployment name may not be empty.');
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
      platform: RequestedPlatform.All,
      projectDir,
      projectId,
      vcsClient,
      env: undefined,
    });

    const { exp } = await getDynamicPublicProjectConfigAsync();
    const { exp: expPrivate } = await getDynamicPrivateProjectConfigAsync();
    const codeSigningInfo = await getCodeSigningInfoAsync(expPrivate, privateKeyPath);

    const channel = await ChannelQuery.viewUpdateChannelAsync(graphqlClient, {
      appId: projectId,
      channelName: deploymentName,
    });

    const createdBranch = await createUpdateBranchOnAppAsync(graphqlClient, {
      appId: projectId,
      name: description, // TODO(wschurman): make this name something else maybe, maybe something with date or something
    });

    const {
      realizedPlatforms,
      unsortedUpdateInfoGroups,
      uploadedAssetCount,
      assetLimitPerUpdateGroup,
    } = await buildAndUploadAssetsAsync({
      graphqlClient,
      projectId,
      skipBundler: false,
      projectDir,
      inputDir: 'dist',
      exp,
      platformFlag: 'all',
      clearCache,
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

    const runtimeVersionsArr = Array.from(new Set(runtimeVersions.map(r => r.runtimeVersion)));
    if (runtimeVersionsArr.length > 1) {
      throw new Error(
        'Using codepush requires the runtime version to be the same for all platforms'
      );
    }

    const gitCommitHash = await vcsClient.getCommitHashAsync();
    const isGitWorkingTreeDirty = await vcsClient.hasUncommittedChangesAsync();

    const { newUpdates } = await publishUpdateGroupsAsync({
      graphqlClient,
      branchId: createdBranch.id,
      runtimeVersions,
      gitCommitHash,
      isGitWorkingTreeDirty,
      unsortedUpdateInfoGroups,
      updateMessage: description,
      codeSigningInfo,
    });

    // set channel rollout
    const rolloutPercent = disabled ? 0 : rollout ?? 100;
    const existingBranchMappingString = channel.branchMapping;
    let updatedBranchMapping: BranchMapping;
    if (!existingBranchMappingString) {
      updatedBranchMapping = getAlwaysTrueBranchMapping(createdBranch.id);
    } else {
      const existingBranchMapping = getBranchMapping(existingBranchMappingString);
      if (isEmptyBranchMapping(existingBranchMapping)) {
        updatedBranchMapping = getAlwaysTrueBranchMapping(createdBranch.id);
      } else if (isAlwaysTrueBranchMapping(existingBranchMapping)) {
        updatedBranchMapping =
          rolloutPercent === 100
            ? getAlwaysTrueBranchMapping(createdBranch.id)
            : createRolloutBranchMapping({
                defaultBranchId: existingBranchMapping.data[0].branchId,
                rolloutBranchId: createdBranch.id,
                runtimeVersion: runtimeVersionsArr[0],
                percent: rolloutPercent,
              });
      } else if (isRolloutBranchMapping(existingBranchMapping)) {
        if (rolloutPercent !== 100) {
          throw new Error('Cannot start a rollout on a deployment when one is already in progress');
        }
        updatedBranchMapping = getAlwaysTrueBranchMapping(createdBranch.id);
      } else {
        throw new Error('Unrecognized custom deployment structure');
      }
    }

    await updateChannelBranchMappingAsync(graphqlClient, {
      channelId: channel.id,
      branchMapping: JSON.stringify(updatedBranchMapping),
    });

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
            { label: 'Branch', value: createdBranch.name },
            { label: 'Runtime version', value: runtime.runtimeVersion },
            { label: 'Platform', value: platforms.join(', ') },
            { label: 'Update group ID', value: updateGroupId },
            ...(newAndroidUpdate
              ? [{ label: 'Android update ID', value: newAndroidUpdate.id }]
              : []),
            ...(newIosUpdate ? [{ label: 'iOS update ID', value: newIosUpdate.id }] : []),
            { label: 'Message', value: description ?? '' },
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
}
