import { Platform } from '@expo/eas-build-job';
import { BuildProfile, CredentialsSource } from '@expo/eas-json';
import { Errors, Flags } from '@oclif/core';

import { runBuildAndSubmitAsync } from '../../build/runBuildAndSubmit';
import EasCommand from '../../commandUtils/EasCommand';
import {
  BuildStatus,
  DistributionType,
  EnvironmentVariableEnvironment,
} from '../../graphql/generated';
import { BuildQuery } from '../../graphql/queries/BuildQuery';
import { toAppPlatform } from '../../graphql/types/AppPlatform';
import Log from '../../log';
import { RequestedPlatform } from '../../platform';
import { resolveWorkflowAsync } from '../../project/workflow';
import { runAsync } from '../../run/run';
import { downloadAndMaybeExtractAppAsync } from '../../utils/download';
import { createFingerprintAsync } from '../../utils/fingerprintCli';

export default class BuildDev extends EasCommand {
  static override description =
    'run dev client simulator/emulator build with matching fingerprint or create a new one';

  static override flags = {
    platform: Flags.enum<RequestedPlatform.Ios | RequestedPlatform.Android>({
      char: 'p',
      options: [RequestedPlatform.Android, RequestedPlatform.Ios],
      required: true,
    }),
  };

  static override contextDefinition = {
    ...this.ContextOptions.LoggedIn,
    ...this.ContextOptions.DynamicProjectConfig,
    ...this.ContextOptions.ProjectDir,
    ...this.ContextOptions.Vcs,
    ...this.ContextOptions.Analytics,
    ...this.ContextOptions.ServerSideEnvironmentVariables,
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
      getServerSideEnvironmentVariablesAsync,
      projectId,
    } = await this.getContextAsync(BuildDev, {
      nonInteractive: false,
      withServerSideEnvironment: EnvironmentVariableEnvironment.Development,
    });

    const platform = flags.platform === RequestedPlatform.Android ? Platform.ANDROID : Platform.IOS;
    if (process.platform !== 'darwin' && platform === Platform.IOS) {
      Errors.error('iOS builds are only supported on macOS.', { exit: 1 });
    }

    const [env, workflow] = await Promise.all([
      getServerSideEnvironmentVariablesAsync(),
      resolveWorkflowAsync(projectDir, platform, vcsClient),
    ]);

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

    const builds = await BuildQuery.viewBuildsOnAppAsync(graphqlClient, {
      appId: projectId,
      filter: {
        platform: toAppPlatform(platform),
        fingerprintHash: fingerprint.hash,
        status: BuildStatus.Finished,
        simulator: platform === Platform.IOS ? true : undefined,
        distribution: DistributionType.Internal,
        developmentClient: true,
      },
      offset: 0,
      limit: 1,
    });
    if (builds.length !== 0) {
      const build = builds[0];
      Log.succeed(
        `🎯 Found successful build with matching fingerprint on EAS servers. Running it...`
      );

      if (build.artifacts?.applicationArchiveUrl) {
        const buildPath = await downloadAndMaybeExtractAppAsync(
          build.artifacts.applicationArchiveUrl,
          build.platform
        );
        await runAsync(buildPath, build.platform);
        return;
      } else {
        Log.warn('Artifacts for this build expired. New build will be started.');
      }
    }

    Log.log('🚀 No successful build with matching fingerprint found. Starting a new build...');
    const androidBuildProfile: BuildProfile<Platform.ANDROID> = {
      credentialsSource: CredentialsSource.LOCAL,
      distribution: 'internal',
      withoutCredentials: true,
      developmentClient: true,
    };
    const iosBuildProfile: BuildProfile<Platform.IOS> = {
      credentialsSource: CredentialsSource.LOCAL,
      distribution: 'internal',
      simulator: true,
      developmentClient: true,
    };

    await runBuildAndSubmitAsync({
      graphqlClient,
      analytics,
      vcsClient,
      projectDir,
      flags: {
        requestedPlatform: flags.platform,
        nonInteractive: false,
        freezeCredentials: false,
        wait: true,
        clearCache: false,
        json: false,
        autoSubmit: false,
        localBuildOptions: {},
        repack: false,
      },
      actor,
      getDynamicPrivateProjectConfigAsync,
      buildProfilesOverride: [
        platform === Platform.ANDROID
          ? {
              platform: Platform.ANDROID,
              profile: androidBuildProfile,
              profileName: '__internal-dev-client__',
            }
          : {
              platform: Platform.IOS,
              profile: iosBuildProfile,
              profileName: '__internal-dev-client__',
            },
      ],
      downloadSimBuildAutoConfirm: true,
      envOverride: env,
    });
  }
}
