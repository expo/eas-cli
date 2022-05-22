import { ExpoConfig } from '@expo/config';
import { getRuntimeVersionNullable } from '@expo/config-plugins/build/utils/Updates';
import { Platform, Workflow } from '@expo/eas-build-job';
import { BuildProfile } from '@expo/eas-json';
import { Flags } from '@oclif/core';

import EasCommand from '../../../commandUtils/EasCommand';
import { AppVersionMutation } from '../../../graphql/mutations/AppVersionMutation';
import { AppVersionQuery } from '../../../graphql/queries/AppVersionQuery';
import { toAppPlatform } from '../../../graphql/types/AppPlatform';
import Log from '../../../log';
import {
  ensureApplicationIdIsDefinedForManagedProjectAsync,
  getApplicationIdAsync,
} from '../../../project/android/applicationId';
import { resolveGradleBuildContextAsync } from '../../../project/android/gradle';
import { getExpoConfig } from '../../../project/expoConfig';
import { getBundleIdentifierAsync } from '../../../project/ios/bundleIdentifier';
import { resolveXcodeBuildContextAsync } from '../../../project/ios/scheme';
import { findApplicationTarget, resolveTargetsAsync } from '../../../project/ios/target';
import { findProjectRootAsync, getProjectIdAsync } from '../../../project/projectUtils';
import { resolveWorkflowAsync } from '../../../project/workflow';
import { promptAsync } from '../../../prompts';
import { ProfileData, getProfilesAsync } from '../../../utils/profiles';

export default class BuildVersionSetView extends EasCommand {
  static description = 'Set managed version for the app.';

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
    const exp = getExpoConfig(projectDir);
    const projectId = await getProjectIdAsync(exp);

    const platform = await selectPlatformAsync(flags.platform);
    const buildProfiles = await getProfilesAsync({
      type: 'build',
      projectDir,
      platforms: [platform],
      profileName: flags.profile ?? undefined,
    });
    const profile = buildProfiles[0];

    const applicationIdentifier = await getApplicationIdentifierAsync(projectDir, exp, profile);
    const remoteVersions = await AppVersionQuery.latestVersionAsync(
      projectId,
      toAppPlatform(platform),
      applicationIdentifier
    );
    const currentStateMessage = remoteVersions?.buildVersion
      ? `Project projectName with ${getApplicationIdentifierName(
          platform
        )} "${applicationIdentifier}" is configured with ${getBuildVersionName(platform)} ${
          remoteVersions?.buildVersion
        }`
      : `Project projectName with ${getApplicationIdentifierName(
          platform
        )} "${applicationIdentifier}" does not have any managed version configured`;

    const versionPromptMessage = remoteVersions?.buildVersion
      ? `What version would you like to set?`
      : `What version would you like to initialize it with?`;
    Log.log(currentStateMessage);

    const { version } = await promptAsync({
      type: platform === Platform.ANDROID ? 'number' : 'text',
      name: 'version',
      message: versionPromptMessage,
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

function getBuildVersionName(platform: Platform): string {
  if (platform === Platform.ANDROID) {
    return 'versionCode';
  } else {
    return 'buildNumber';
  }
}

async function getApplicationIdentifierAsync(
  projectDir: string,
  exp: ExpoConfig,
  profileData: ProfileData<'build'>
): Promise<string> {
  if (profileData.platform === Platform.ANDROID) {
    const profile = profileData.profile as BuildProfile<Platform.ANDROID>;
    const workflow = await resolveWorkflowAsync(projectDir, Platform.ANDROID);
    const gradleContext = await resolveGradleBuildContextAsync(projectDir, profile);

    if (workflow === Workflow.MANAGED) {
      await ensureApplicationIdIsDefinedForManagedProjectAsync(projectDir, exp);
    }

    return await getApplicationIdAsync(projectDir, exp, gradleContext);
  } else {
    const profile = profileData.profile as BuildProfile<Platform.IOS>;
    const xcodeBuildContext = await resolveXcodeBuildContextAsync(
      { exp, projectDir, nonInteractive: false },
      profile
    );
    const targets = await resolveTargetsAsync({
      projectDir,
      exp,
      xcodeBuildContext,
      env: profile.env,
    });
    const applicationTarget = findApplicationTarget(targets);
    return await getBundleIdentifierAsync(projectDir, exp, {
      targetName: applicationTarget.targetName,
      buildConfiguration: applicationTarget.buildConfiguration,
    });
  }
}

async function selectPlatformAsync(platform?: string): Promise<Platform> {
  if (platform && Object.values(Platform).includes(platform.toLowerCase() as Platform)) {
    return platform.toLowerCase() as Platform;
  }

  const { requestedPlatform } = await promptAsync({
    type: 'select',
    message: 'Select platform',
    name: 'requestedPlatform',
    choices: [
      { title: 'Android', value: Platform.ANDROID },
      { title: 'iOS', value: Platform.IOS },
    ],
  });
  return requestedPlatform;
}
