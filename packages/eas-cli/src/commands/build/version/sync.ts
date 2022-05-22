import { ExpoConfig, getConfigFilePaths } from '@expo/config';
import { Platform, Workflow } from '@expo/eas-build-job';
import { BuildProfile } from '@expo/eas-json';
import { Flags } from '@oclif/core';
import assert from 'assert';

import { writeVersionsToBuildGradleAsync } from '../../../build/android/version';
import { updateNativeVersionsAsync } from '../../../build/ios/version';
import { updateAppJsonConfigAsync } from '../../../build/utils/appJson';
import EasCommand from '../../../commandUtils/EasCommand';
import { AppPlatform } from '../../../graphql/generated';
import { AppVersionQuery } from '../../../graphql/queries/AppVersionQuery';
import Log from '../../../log';
import { RequestedPlatform, toPlatforms } from '../../../platform';
import {
  ensureApplicationIdIsDefinedForManagedProjectAsync,
  getApplicationIdAsync,
} from '../../../project/android/applicationId';
import { resolveGradleBuildContextAsync } from '../../../project/android/gradle';
import { getAppBuildGradleAsync } from '../../../project/android/gradleUtils';
import { getExpoConfig } from '../../../project/expoConfig';
import { getBundleIdentifierAsync } from '../../../project/ios/bundleIdentifier';
import { resolveXcodeBuildContextAsync } from '../../../project/ios/scheme';
import { findApplicationTarget, resolveTargetsAsync } from '../../../project/ios/target';
import { findProjectRootAsync, getProjectIdAsync } from '../../../project/projectUtils';
import { resolveWorkflowAsync } from '../../../project/workflow';
import { getProfilesAsync } from '../../../utils/profiles';

interface SyncContext<T extends Platform> {
  projectDir: string;
  exp: ExpoConfig;
  profile: BuildProfile<T>;
  projectId: string;
}

export default class BuildVersionSyncView extends EasCommand {
  public static description = 'update your local project with version stored on Expo servers';

  public static flags = {
    platform: Flags.enum({
      char: 'p',
      options: ['android', 'ios', 'all'],
    }),
    profile: Flags.string({
      description:
        'Name of the build profile from eas.json. Defaults to "production" if defined in eas.json.',
      helpValue: 'PROFILE_NAME',
    }),
  };

  public async runAsync(): Promise<void> {
    const { flags } = await this.parse(BuildVersionSyncView);
    assert(flags.platform);

    const projectDir = await findProjectRootAsync();
    const exp = getExpoConfig(projectDir);
    const projectId = await getProjectIdAsync(exp);

    const platforms = toPlatforms(flags.platform as RequestedPlatform);
    const buildProfiles = await getProfilesAsync({
      type: 'build',
      projectDir,
      platforms,
      profileName: flags.profile ?? undefined,
    });
    for (const profileInfo of buildProfiles) {
      if (profileInfo.platform === Platform.ANDROID) {
        this.syncAndroidAsync({
          projectDir,
          exp,
          profile: profileInfo.profile as BuildProfile<Platform.ANDROID>,
          projectId,
        });
      } else {
        this.syncIosAsync({
          projectDir,
          exp,
          profile: profileInfo.profile as BuildProfile<Platform.IOS>,
          projectId,
        });
      }
    }
  }

  private async syncIosAsync({
    projectDir,
    exp,
    projectId,
    profile,
  }: SyncContext<Platform.IOS>): Promise<void> {
    const workflow = await resolveWorkflowAsync(projectDir, Platform.IOS);
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
    const bundleIdentifier = await getBundleIdentifierAsync(projectDir, exp, {
      targetName: applicationTarget.targetName,
      buildConfiguration: applicationTarget.buildConfiguration,
    });
    const versions = await AppVersionQuery.latestVersionAsync(
      projectId,
      AppPlatform.Ios,
      bundleIdentifier
    );
    assert(versions, 'TODO');

    const paths = getConfigFilePaths(projectDir);
    if (!paths.staticConfigPath) {
      Log.error('not supported');
      return;
    }
    await updateAppJsonConfigAsync({ projectDir, exp }, (config: ExpoConfig) => {
      config.ios = { ...config.ios, buildNumber: versions.buildVersion };
    });
    if (workflow === Workflow.GENERIC) {
      await updateNativeVersionsAsync({
        projectDir,
        buildNumber: versions.buildVersion,
        targets,
      });
    }
  }

  private async syncAndroidAsync({
    projectDir,
    exp,
    projectId,
    profile,
  }: SyncContext<Platform.ANDROID>): Promise<void> {
    const workflow = await resolveWorkflowAsync(projectDir, Platform.ANDROID);
    const gradleContext = await resolveGradleBuildContextAsync(projectDir, profile);

    if (workflow === Workflow.MANAGED) {
      await ensureApplicationIdIsDefinedForManagedProjectAsync(projectDir, exp);
    }

    const applicationId = await getApplicationIdAsync(projectDir, exp, gradleContext);
    const versions = await AppVersionQuery.latestVersionAsync(
      projectId,
      AppPlatform.Android,
      applicationId
    );
    assert(versions, 'TODO');
    const paths = getConfigFilePaths(projectDir);
    if (!paths.staticConfigPath) {
      Log.error('not supported');
      return;
    }
    await updateAppJsonConfigAsync({ projectDir, exp }, (config: ExpoConfig) => {
      config.android = { ...config.android, versionCode: parseInt(versions.buildVersion, 10) };
    });
    if (workflow === Workflow.GENERIC) {
      const buildGradle = await getAppBuildGradleAsync(projectDir);
      const isMultiFlavor =
        buildGradle.android?.productFlavors || buildGradle.android?.flavorDimensions;
      if (isMultiFlavor) {
        throw new Error(
          "Versions in native code can't be automatically synced in multi-flavor Android projects, but if you are using managed versioning on EAS resulting archive will have a correct version."
        );
      }
      await writeVersionsToBuildGradleAsync({ projectDir, exp });
    }
  }
}
