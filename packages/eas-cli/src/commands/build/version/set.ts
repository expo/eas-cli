import { getRuntimeVersionNullableAsync } from '@expo/config-plugins/build/utils/Updates';
import { Platform } from '@expo/eas-build-job';
import { EasJsonAccessor, EasJsonUtils } from '@expo/eas-json';
import { Flags } from '@oclif/core';
import chalk from 'chalk';

import { evaluateConfigWithEnvVarsAsync } from '../../../build/evaluateConfigWithEnvVarsAsync';
import EasCommand from '../../../commandUtils/EasCommand';
import { AppVersionMutation } from '../../../graphql/mutations/AppVersionMutation';
import { AppVersionQuery } from '../../../graphql/queries/AppVersionQuery';
import { toAppPlatform } from '../../../graphql/types/AppPlatform';
import Log from '../../../log';
import { selectPlatformAsync } from '../../../platform';
import { VERSION_CODE_REQUIREMENTS, isValidVersionCode } from '../../../project/android/versions';
import { getApplicationIdentifierAsync } from '../../../project/applicationIdentifier';
import { BUILD_NUMBER_REQUIREMENTS, isValidBuildNumber } from '../../../project/ios/versions';
import { getDisplayNameForProjectIdAsync } from '../../../project/projectUtils';
import {
  ensureVersionSourceIsRemoteAsync,
  getBuildVersionName,
  validateAppConfigForRemoteVersionSource,
} from '../../../project/remoteVersionSource';
import { promptAsync } from '../../../prompts';

export default class BuildVersionSetView extends EasCommand {
  static override description = 'update version of an app';

  static override flags = {
    platform: Flags.enum({
      char: 'p',
      options: ['android', 'ios'],
    }),
    profile: Flags.string({
      char: 'e',
      description:
        'Name of the build profile from eas.json. Defaults to "production" if defined in eas.json.',
      helpValue: 'PROFILE_NAME',
    }),
  };

  static override contextDefinition = {
    ...this.ContextOptions.LoggedIn,
    ...this.ContextOptions.DynamicProjectConfig,
    ...this.ContextOptions.ProjectDir,
    ...this.ContextOptions.Vcs,
  };

  public async runAsync(): Promise<void> {
    const { flags } = await this.parse(BuildVersionSetView);
    const {
      loggedIn: { graphqlClient },
      getDynamicPrivateProjectConfigAsync,
      projectDir,
      vcsClient,
    } = await this.getContextAsync(BuildVersionSetView, {
      nonInteractive: false,
      withServerSideEnvironment: null,
    });

    const platform = await selectPlatformAsync(flags.platform);
    const easJsonAccessor = EasJsonAccessor.fromProjectPath(projectDir);
    await ensureVersionSourceIsRemoteAsync(easJsonAccessor, { nonInteractive: false });
    const profile = await EasJsonUtils.getBuildProfileAsync(
      easJsonAccessor,
      platform,
      flags.profile ?? undefined
    );

    const { exp, projectId, env } = await evaluateConfigWithEnvVarsAsync({
      buildProfile: profile,
      buildProfileName: flags.profile ?? 'production',
      graphqlClient,
      getProjectConfig: getDynamicPrivateProjectConfigAsync,
      opts: { env: profile.env },
    });
    const displayName = await getDisplayNameForProjectIdAsync(graphqlClient, projectId);

    validateAppConfigForRemoteVersionSource(exp, platform);

    const applicationIdentifier = await getApplicationIdentifierAsync({
      graphqlClient,
      projectDir,
      projectId,
      exp,
      buildProfile: profile,
      platform,
      vcsClient,
      nonInteractive: false,
      env,
    });
    const remoteVersions = await AppVersionQuery.latestVersionAsync(
      graphqlClient,
      projectId,
      toAppPlatform(platform),
      applicationIdentifier
    );
    const currentStateMessage = remoteVersions?.buildVersion
      ? `Project ${chalk.bold(displayName)} with ${getApplicationIdentifierName(
          platform
        )} "${applicationIdentifier}" is configured with ${getBuildVersionName(platform)} ${
          remoteVersions.buildVersion
        }.`
      : `Project ${chalk.bold(displayName)} with ${getApplicationIdentifierName(
          platform
        )} "${applicationIdentifier}" does not have any ${getBuildVersionName(
          platform
        )} configured.`;

    const versionPromptMessage = remoteVersions?.buildVersion
      ? `What version would you like to set?`
      : `What version would you like to initialize it with?`;
    Log.log(currentStateMessage);

    const { version } = await promptAsync({
      type: platform === Platform.ANDROID ? 'number' : 'text',
      name: 'version',
      message: versionPromptMessage,
      validate:
        platform === Platform.ANDROID
          ? value => isValidVersionCode(value) || `Invalid value: ${VERSION_CODE_REQUIREMENTS}.`
          : value => isValidBuildNumber(value) || `Invalid value: ${BUILD_NUMBER_REQUIREMENTS}.`,
    });
    await AppVersionMutation.createAppVersionAsync(graphqlClient, {
      appId: projectId,
      platform: toAppPlatform(platform),
      applicationIdentifier,
      storeVersion: exp.version ?? '1.0.0',
      buildVersion: String(version),
      runtimeVersion:
        (await getRuntimeVersionNullableAsync(projectDir, exp, platform)) ?? undefined,
    });
  }
}

function getApplicationIdentifierName(platform: Platform): string {
  if (platform === Platform.ANDROID) {
    return 'application ID';
  } else {
    return 'bundle identifier';
  }
}
