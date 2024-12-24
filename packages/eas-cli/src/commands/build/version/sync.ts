import { ExpoConfig } from '@expo/config';
import { Platform, Workflow } from '@expo/eas-build-job';
import { BuildProfile, EasJsonAccessor } from '@expo/eas-json';
import { Flags } from '@oclif/core';
import chalk from 'chalk';

import { updateNativeVersionsAsync as updateAndroidNativeVersionsAsync } from '../../../build/android/version';
import { evaluateConfigWithEnvVarsAsync } from '../../../build/evaluateConfigWithEnvVarsAsync';
import { updateNativeVersionsAsync as updateIosNativeVersionsAsync } from '../../../build/ios/version';
import EasCommand from '../../../commandUtils/EasCommand';
import { AppVersionQuery } from '../../../graphql/queries/AppVersionQuery';
import { toAppPlatform } from '../../../graphql/types/AppPlatform';
import Log from '../../../log';
import {
  appPlatformDisplayNames,
  selectRequestedPlatformAsync,
  toPlatforms,
} from '../../../platform';
import { getAppBuildGradleAsync } from '../../../project/android/gradleUtils';
import { VERSION_CODE_REQUIREMENTS, isValidVersionCode } from '../../../project/android/versions';
import { getApplicationIdentifierAsync } from '../../../project/applicationIdentifier';
import { resolveXcodeBuildContextAsync } from '../../../project/ios/scheme';
import { resolveTargetsAsync } from '../../../project/ios/target';
import { BUILD_NUMBER_REQUIREMENTS, isValidBuildNumber } from '../../../project/ios/versions';
import {
  ensureVersionSourceIsRemoteAsync,
  getBuildVersionName,
  validateAppConfigForRemoteVersionSource,
} from '../../../project/remoteVersionSource';
import { resolveWorkflowAsync } from '../../../project/workflow';
import { getProfilesAsync } from '../../../utils/profiles';
import { Client } from '../../../vcs/vcs';

interface SyncContext<T extends Platform> {
  projectDir: string;
  exp: ExpoConfig;
  workflow: Workflow;
  profile: BuildProfile<T>;
  buildVersion: string;
  vcsClient: Client;
}

export default class BuildVersionSyncView extends EasCommand {
  public static override description =
    'update a version in native code with a value stored on EAS servers';

  public static override flags = {
    platform: Flags.enum({
      char: 'p',
      options: ['android', 'ios', 'all'],
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
    const { flags } = await this.parse(BuildVersionSyncView);
    const {
      loggedIn: { graphqlClient },
      getDynamicPrivateProjectConfigAsync,
      projectDir,
      vcsClient,
    } = await this.getContextAsync(BuildVersionSyncView, {
      nonInteractive: true,
      withServerSideEnvironment: null,
    });

    const requestedPlatform = await selectRequestedPlatformAsync(flags.platform);
    const easJsonAccessor = EasJsonAccessor.fromProjectPath(projectDir);
    await ensureVersionSourceIsRemoteAsync(easJsonAccessor, { nonInteractive: false });

    const platforms = toPlatforms(requestedPlatform);
    const buildProfiles = await getProfilesAsync({
      type: 'build',
      easJsonAccessor,
      platforms,
      profileName: flags.profile ?? undefined,
      projectDir,
    });
    for (const profileInfo of buildProfiles) {
      const { exp, projectId, env } = await evaluateConfigWithEnvVarsAsync({
        buildProfile: profileInfo.profile,
        buildProfileName: profileInfo.profileName,
        graphqlClient,
        getProjectConfig: getDynamicPrivateProjectConfigAsync,
        opts: { env: profileInfo.profile.env },
      });

      validateAppConfigForRemoteVersionSource(exp, profileInfo.platform);
      const platformDisplayName = appPlatformDisplayNames[toAppPlatform(profileInfo.platform)];

      const applicationIdentifier = await getApplicationIdentifierAsync({
        graphqlClient,
        projectDir,
        projectId,
        exp,
        buildProfile: profileInfo.profile,
        platform: profileInfo.platform,
        vcsClient,
        nonInteractive: false,
        env,
      });
      const remoteVersions = await AppVersionQuery.latestVersionAsync(
        graphqlClient,
        projectId,
        toAppPlatform(profileInfo.platform),
        applicationIdentifier
      );
      const workflow = await resolveWorkflowAsync(projectDir, profileInfo.platform, vcsClient);
      if (!remoteVersions?.buildVersion) {
        Log.warn(
          `Skipping versions sync for ${platformDisplayName}. There are no versions configured on EAS, use "eas build:version:set" or run a build to initialize it.`
        );
        continue;
      }
      if (workflow === Workflow.MANAGED) {
        Log.warn(
          `The remote value for the ${platformDisplayName} ${getBuildVersionName(
            profileInfo.platform
          )} is ${chalk.bold(
            remoteVersions?.buildVersion
          )}, but it was not synced to the local project. This command has no effect on projects using managed workflow.`
        );
        continue;
      }
      if (profileInfo.platform === Platform.ANDROID) {
        await this.syncAndroidAsync({
          projectDir,
          exp,
          profile: profileInfo.profile as BuildProfile<Platform.ANDROID>,
          workflow,
          buildVersion: remoteVersions.buildVersion,
          vcsClient,
        });
      } else {
        await this.syncIosAsync({
          projectDir,
          exp,
          profile: profileInfo.profile as BuildProfile<Platform.IOS>,
          workflow,
          buildVersion: remoteVersions.buildVersion,
          vcsClient,
        });
      }
      Log.withTick(
        `Successfully updated the ${platformDisplayName} ${getBuildVersionName(
          profileInfo.platform
        )} in native code to ${chalk.bold(remoteVersions?.buildVersion)}.`
      );
    }
  }

  private async syncIosAsync({
    workflow,
    projectDir,
    exp,
    profile,
    buildVersion,
    vcsClient,
  }: SyncContext<Platform.IOS>): Promise<void> {
    const xcodeBuildContext = await resolveXcodeBuildContextAsync(
      { exp, projectDir, nonInteractive: false, vcsClient },
      profile
    );
    const targets = await resolveTargetsAsync({
      projectDir,
      exp,
      xcodeBuildContext,
      env: profile.env,
      vcsClient,
    });

    if (!isValidBuildNumber(buildVersion)) {
      throw new Error(`Invalid buildNumber (${buildVersion}), ${BUILD_NUMBER_REQUIREMENTS}.`);
    }

    if (workflow === Workflow.GENERIC) {
      await updateIosNativeVersionsAsync({
        projectDir,
        buildNumber: buildVersion,
        targets,
      });
    }
  }

  private async syncAndroidAsync({
    projectDir,
    workflow,
    buildVersion,
  }: SyncContext<Platform.ANDROID>): Promise<void> {
    if (!isValidVersionCode(buildVersion)) {
      throw new Error(`Invalid versionCode (${buildVersion}), ${VERSION_CODE_REQUIREMENTS}.`);
    }

    if (workflow === Workflow.GENERIC) {
      const buildGradle = await getAppBuildGradleAsync(projectDir);
      const isMultiFlavor =
        buildGradle.android?.productFlavors ?? buildGradle.android?.flavorDimensions;
      if (isMultiFlavor) {
        throw new Error(
          "Versions in native code can't be automatically synced in multi-flavor Android projects. If you are using EAS Build with app version source set to remote, the correct values will be injected at the build time."
        );
      }
      await updateAndroidNativeVersionsAsync({ projectDir, versionCode: Number(buildVersion) });
    }
  }
}
