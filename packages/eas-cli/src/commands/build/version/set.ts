import { getRuntimeVersionNullable } from '@expo/config-plugins/build/utils/Updates';
import { Platform } from '@expo/eas-build-job';
import { EasJsonReader } from '@expo/eas-json';
import { Flags } from '@oclif/core';
import chalk from 'chalk';

import EasCommand from '../../../commandUtils/EasCommand';
import { AppVersionMutation } from '../../../graphql/mutations/AppVersionMutation';
import { AppVersionQuery } from '../../../graphql/queries/AppVersionQuery';
import { toAppPlatform } from '../../../graphql/types/AppPlatform';
import Log from '../../../log';
import { selectPlatformAsync } from '../../../platform';
import { VERSION_CODE_REQUIREMENTS, isValidVersionCode } from '../../../project/android/versions';
import { getApplicationIdentifierAsync } from '../../../project/applicationIdentifier';
import { getExpoConfig } from '../../../project/expoConfig';
import { BUILD_NUMBER_REQUIREMENTS, isValidBuildNumber } from '../../../project/ios/versions';
import {
  findProjectRootAsync,
  getProjectFullNameAsync,
  getProjectIdAsync,
} from '../../../project/projectUtils';
import {
  ensureVersionSourceIsRemoteAsync,
  getBuildVersionName,
  validateAppConfigForRemoteVersionSource,
} from '../../../project/remoteVersionSource';
import { promptAsync } from '../../../prompts';

export default class BuildVersionSetView extends EasCommand {
  static description = 'Update version of an app.';

  static flags = {
    platform: Flags.enum({
      char: 'p',
      options: ['android', 'ios'],
    }),
    profile: Flags.string({
      description:
        'Name of the build profile from eas.json. Defaults to "production" if defined in eas.json.',
      helpValue: 'PROFILE_NAME',
    }),
  };

  public async runAsync(): Promise<void> {
    const { flags } = await this.parse(BuildVersionSetView);

    const projectDir = await findProjectRootAsync();

    const platform = await selectPlatformAsync(flags.platform);
    const easJsonReader = new EasJsonReader(projectDir);
    await ensureVersionSourceIsRemoteAsync(projectDir, easJsonReader);
    const profile = await easJsonReader.getBuildProfileAsync(platform, flags.profile ?? undefined);

    const exp = getExpoConfig(projectDir, { env: profile.env });
    const projectId = await getProjectIdAsync(exp);
    const projectFullName = await getProjectFullNameAsync(exp);
    validateAppConfigForRemoteVersionSource(exp, platform);

    const applicationIdentifier = await getApplicationIdentifierAsync(
      projectDir,
      exp,
      profile,
      platform
    );
    const remoteVersions = await AppVersionQuery.latestVersionAsync(
      projectId,
      toAppPlatform(platform),
      applicationIdentifier
    );
    const currentStateMessage = remoteVersions?.buildVersion
      ? `Project ${chalk.bold(projectFullName)} with ${getApplicationIdentifierName(
          platform
        )} "${applicationIdentifier}" is configured with ${getBuildVersionName(platform)} ${
          remoteVersions.buildVersion
        }.`
      : `Project ${chalk.bold(projectFullName)} with ${getApplicationIdentifierName(
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
    await AppVersionMutation.createAppVersionAsync({
      appId: projectId,
      platform: toAppPlatform(platform),
      applicationIdentifier,
      storeVersion: exp.version ?? '1.0.0',
      buildVersion: String(version),
      runtimeVersion: getRuntimeVersionNullable(exp, platform) ?? undefined,
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
