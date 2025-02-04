import { Platform } from '@expo/eas-build-job';
import { BuildProfile, EasJsonAccessor } from '@expo/eas-json';
import { Errors, Flags } from '@oclif/core';
import chalk from 'chalk';

import {
  createBuildProfileAsync,
  doesBuildProfileExistAsync,
  ensureProjectConfiguredAsync,
} from '../../build/configure';
import { evaluateConfigWithEnvVarsAsync } from '../../build/evaluateConfigWithEnvVarsAsync';
import { downloadAndRunAsync, runBuildAndSubmitAsync } from '../../build/runBuildAndSubmit';
import { ensureRepoIsCleanAsync } from '../../build/utils/repository';
import EasCommand from '../../commandUtils/EasCommand';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { BuildFragment, BuildStatus, DistributionType } from '../../graphql/generated';
import { BuildQuery } from '../../graphql/queries/BuildQuery';
import { toAppPlatform } from '../../graphql/types/AppPlatform';
import Log from '../../log';
import { RequestedPlatform } from '../../platform';
import { resolveWorkflowAsync } from '../../project/workflow';
import { confirmAsync, promptAsync } from '../../prompts';
import { expoCommandAsync } from '../../utils/expoCli';
import { createFingerprintAsync } from '../../utils/fingerprintCli';
import { ProfileData, getProfilesAsync } from '../../utils/profiles';
import { Client } from '../../vcs/vcs';

const DEFAULT_EAS_BUILD_RUN_PROFILE_NAME = 'development-simulator';

export default class BuildDev extends EasCommand {
  static override hidden: true;

  static override description =
    'run dev client simulator/emulator build with matching fingerprint or create a new one';

  static override flags = {
    platform: Flags.enum<Platform.IOS | Platform.ANDROID>({
      char: 'p',
      options: [Platform.IOS, Platform.ANDROID],
    }),
    profile: Flags.string({
      char: 'e',
      description: `Name of the build profile from eas.json. It must be a profile allowing to create emulator/simulator internal distribution dev client builds. The "${DEFAULT_EAS_BUILD_RUN_PROFILE_NAME}" build profile will be selected by default.`,
      helpValue: 'PROFILE_NAME',
    }),
  };

  static override contextDefinition = {
    ...this.ContextOptions.LoggedIn,
    ...this.ContextOptions.DynamicProjectConfig,
    ...this.ContextOptions.ProjectDir,
    ...this.ContextOptions.Vcs,
    ...this.ContextOptions.Analytics,
    ...this.ContextOptions.ProjectId,
  };

  protected override async runAsync(): Promise<any> {
    const { flags } = await this.parse(BuildDev);

    const {
      loggedIn: { actor, graphqlClient },
      getDynamicPrivateProjectConfigAsync,
      projectDir,
      analytics,
      vcsClient,
      projectId,
    } = await this.getContextAsync(BuildDev, {
      nonInteractive: false,
      withServerSideEnvironment: null,
    });

    const platform = await this.selectPlatformAsync(flags.platform);
    if (process.platform !== 'darwin' && platform === Platform.IOS) {
      Errors.error('Running iOS builds in simulator is only supported on macOS.', { exit: 1 });
    }

    await vcsClient.ensureRepoExistsAsync();
    await ensureRepoIsCleanAsync(vcsClient, flags.nonInteractive);
    await ensureProjectConfiguredAsync({
      projectDir,
      nonInteractive: false,
      vcsClient,
    });

    const buildProfile = await this.ensureValidBuildRunProfileExistsAsync({
      projectDir,
      platform,
      selectedBuildProfileName: flags.profile,
      vcsClient,
    });

    const workflow = await resolveWorkflowAsync(projectDir, platform, vcsClient);

    const { env } = await evaluateConfigWithEnvVarsAsync({
      buildProfile: buildProfile.profile,
      buildProfileName: buildProfile.profileName,
      graphqlClient,
      getProjectConfig: getDynamicPrivateProjectConfigAsync,
      opts: { env: buildProfile.profile.env },
    });

    const fingerprint = await createFingerprintAsync(projectDir, {
      env,
      workflow,
      platforms: [platform],
    });
    if (!fingerprint) {
      Errors.error('Failed to calculate fingerprint', { exit: 1 });
    }
    Log.log(`✨ Calculated fingerprint hash: ${fingerprint.hash}`);
    Log.newLine();

    const builds = await this.getBuildsAsync({
      graphqlClient,
      projectId,
      platform,
      fingerprint,
    });
    if (builds.length !== 0) {
      const build = builds[0];
      Log.succeed(
        `🎯 Found successful build with matching fingerprint on EAS servers. Running it...`
      );

      if (build.artifacts?.applicationArchiveUrl) {
        await downloadAndRunAsync(build);
        await this.startDevServerAsync({ projectDir, platform });
        return;
      } else {
        Log.warn('Artifacts for this build expired. New build will be started.');
      }
    }

    Log.log('🚀 No successful build with matching fingerprint found. Starting a new build...');

    const previousBuildsForSelectedProfile = await this.getBuildsAsync({
      graphqlClient,
      projectId,
      platform,
    });
    if (
      previousBuildsForSelectedProfile.length > 0 &&
      previousBuildsForSelectedProfile[0].metrics?.buildDuration
    ) {
      Log.log(
        `🕒 Previous build for "${buildProfile.profileName}" profile completed in ${Math.floor(
          previousBuildsForSelectedProfile[0].metrics.buildDuration / 60000
        )} minutes.`
      );
    }

    await runBuildAndSubmitAsync({
      graphqlClient,
      analytics,
      vcsClient,
      projectDir,
      flags: {
        requestedPlatform:
          platform === Platform.ANDROID ? RequestedPlatform.Android : RequestedPlatform.Ios,
        nonInteractive: false,
        freezeCredentials: false,
        wait: true,
        clearCache: false,
        json: false,
        autoSubmit: false,
        localBuildOptions: {},
        repack: false,
        profile: flags.profile ?? DEFAULT_EAS_BUILD_RUN_PROFILE_NAME,
      },
      actor,
      getDynamicPrivateProjectConfigAsync,
      downloadSimBuildAutoConfirm: true,
      envOverride: env,
    });
    await this.startDevServerAsync({ projectDir, platform });
  }

  private async selectPlatformAsync(platform?: Platform): Promise<Platform> {
    if (platform) {
      return platform;
    }
    const { resolvedPlatform } = await promptAsync({
      type: 'select',
      message: 'Select platform',
      name: 'resolvedPlatform',
      choices: [
        { title: 'Android', value: Platform.ANDROID },
        { title: 'iOS', value: Platform.IOS },
      ],
    });
    return resolvedPlatform;
  }

  private async validateBuildRunProfileAsync({
    platform,
    buildProfile,
    buildProfileName,
  }: {
    platform: Platform;
    buildProfile: BuildProfile;
    buildProfileName: string;
  }): Promise<void> {
    if (buildProfile.developmentClient !== true) {
      Errors.error(
        `Profile "${buildProfileName}" must specify "developmentClient: true" to create a dev client build. Select a different profile or update the profile in eas.json.`,
        { exit: 1 }
      );
    }
    if (buildProfile.distribution !== 'internal') {
      Errors.error(
        `Profile "${buildProfileName}" must specify "distribution: internal" in order to work with eas build:dev command. Select a different profile or update the profile in eas.json.`,
        { exit: 1 }
      );
    }

    if (platform === Platform.IOS) {
      const iosProfile = buildProfile as BuildProfile<Platform.IOS>;
      if (iosProfile.simulator !== true && iosProfile.withoutCredentials !== true) {
        Errors.error(
          `Profile "${buildProfileName}" must specify "ios.simulator: true" or "withoutCredentials: true" to create an iOS simulator build. Select a different profile or update the profile in eas.json.`,
          { exit: 1 }
        );
      }
    } else {
      const androidProfile = buildProfile as BuildProfile<Platform.ANDROID>;
      if (
        androidProfile.distribution !== 'internal' &&
        androidProfile.withoutCredentials !== true
      ) {
        Errors.error(
          `Profile "${buildProfileName}" must specify "distribution: internal" or "withoutCredentials: true" to create an Android emulator build. Select a different profile or update the profile in eas.json.`,
          { exit: 1 }
        );
      }
    }
  }

  private async ensureValidBuildRunProfileExistsAsync({
    projectDir,
    platform,
    selectedBuildProfileName,
    vcsClient,
  }: {
    projectDir: string;
    platform: Platform;
    selectedBuildProfileName?: string;
    vcsClient: Client;
  }): Promise<ProfileData<'build'>> {
    if (
      !!selectedBuildProfileName ||
      (await doesBuildProfileExistAsync({
        projectDir,
        profileName: DEFAULT_EAS_BUILD_RUN_PROFILE_NAME,
      }))
    ) {
      const easJsonAccessor = EasJsonAccessor.fromProjectPath(projectDir);
      const [buildProfile] = await getProfilesAsync({
        type: 'build',
        easJsonAccessor,
        platforms: [platform],
        profileName: selectedBuildProfileName ?? DEFAULT_EAS_BUILD_RUN_PROFILE_NAME,
        projectDir,
      });
      await this.validateBuildRunProfileAsync({
        buildProfileName: selectedBuildProfileName ?? DEFAULT_EAS_BUILD_RUN_PROFILE_NAME,
        platform,
        buildProfile: buildProfile.profile,
      });
    } else {
      const createBuildProfile = await confirmAsync({
        message: `We want to go ahead and generate "${DEFAULT_EAS_BUILD_RUN_PROFILE_NAME}" build profile for you, that matches eas build:dev criteria. Do you want to proceed?`,
      });
      if (!createBuildProfile) {
        Errors.error(
          'Come back later or specify different build compliant with eas build:dev requirements by using "--profile" flag.',
          { exit: 1 }
        );
      }
      await createBuildProfileAsync({
        projectDir,
        profileName: DEFAULT_EAS_BUILD_RUN_PROFILE_NAME,
        profileContents: {
          developmentClient: true,
          distribution: 'internal',
          ios: {
            simulator: true,
          },
          environment: 'development',
        },
        nonInteractive: false,
        vcsClient,
      });
    }

    const easJsonAccessor = EasJsonAccessor.fromProjectPath(projectDir);
    const [buildProfile] = await getProfilesAsync({
      type: 'build',
      easJsonAccessor,
      platforms: [platform],
      profileName: selectedBuildProfileName ?? DEFAULT_EAS_BUILD_RUN_PROFILE_NAME,
      projectDir,
    });
    return buildProfile;
  }

  private async getBuildsAsync({
    graphqlClient,
    projectId,
    platform,
    fingerprint,
  }: {
    graphqlClient: ExpoGraphqlClient;
    projectId: string;
    platform: Platform;
    fingerprint?: { hash: string };
  }): Promise<BuildFragment[]> {
    return await BuildQuery.viewBuildsOnAppAsync(graphqlClient, {
      appId: projectId,
      filter: {
        platform: toAppPlatform(platform),
        fingerprintHash: fingerprint?.hash,
        status: BuildStatus.Finished,
        simulator: platform === Platform.IOS ? true : undefined,
        distribution: platform === Platform.ANDROID ? DistributionType.Internal : undefined,
        developmentClient: true,
      },
      offset: 0,
      limit: 1,
    });
  }

  private async startDevServerAsync({
    projectDir,
    platform,
  }: {
    projectDir: string;
    platform: Platform;
  }): Promise<void> {
    Log.newLine();
    Log.log(
      `Starting development server: ${chalk.dim(
        `npx expo start --dev-client ${platform === Platform.IOS ? '--ios' : '--android'}`
      )}`
    );
    await expoCommandAsync(projectDir, [
      'start',
      '--dev-client',
      platform === Platform.IOS ? '--ios' : '--android',
    ]);
  }
}
