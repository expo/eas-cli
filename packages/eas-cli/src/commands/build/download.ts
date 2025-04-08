import { Platform } from '@expo/eas-build-job';
import { Errors, Flags } from '@oclif/core';
import chalk from 'chalk';
import { pathExists } from 'fs-extra';

import EasCommand from '../../commandUtils/EasCommand';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { EasNonInteractiveAndJsonFlags } from '../../commandUtils/flags';
import { AppPlatform, BuildFragment, BuildStatus, DistributionType } from '../../graphql/generated';
import { BuildQuery } from '../../graphql/queries/BuildQuery';
import { toAppPlatform } from '../../graphql/types/AppPlatform';
import Log from '../../log';
import { promptAsync } from '../../prompts';
import { getEasBuildRunCachedAppPath } from '../../run/run';
import { downloadAndMaybeExtractAppAsync } from '../../utils/download';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

export default class Download extends EasCommand {
  static override description = 'download simulator/emulator builds for a given fingerprint hash';

  static override flags = {
    fingerprint: Flags.string({
      description: 'Fingerprint hash of the build to download',
      required: true,
    }),
    platform: Flags.enum<Platform.IOS | Platform.ANDROID>({
      char: 'p',
      options: [Platform.IOS, Platform.ANDROID],
    }),
    'dev-client': Flags.boolean({
      description: 'Filter only dev-client builds.',
    }),
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.LoggedIn,
    ...this.ContextOptions.ProjectId,
  };

  async runAsync(): Promise<void> {
    const {
      flags: {
        json: jsonFlag,
        platform,
        fingerprint,
        'dev-client': developmentClient,
        'non-interactive': nonInteractive,
      },
    } = await this.parse(Download);

    const {
      loggedIn: { graphqlClient },
      projectId,
    } = await this.getContextAsync(Download, {
      nonInteractive,
    });

    if (jsonFlag) {
      enableJsonOutput();
    }

    const selectedPlatform = await resolvePlatformAsync({ nonInteractive, platform });
    const build = await this.getBuildAsync({
      graphqlClient,
      projectId,
      platform: selectedPlatform,
      fingerprintHash: fingerprint,
      developmentClient,
    });
    const buildArtifactPath = await this.getPathToBuildArtifactAsync(build, selectedPlatform);
    if (jsonFlag) {
      const jsonResults = { path: buildArtifactPath };
      printJsonOnlyOutput(jsonResults);
    } else {
      Log.log(`Build downloaded to ${chalk.bold(buildArtifactPath)}`);
    }
  }

  private async getBuildAsync({
    graphqlClient,
    projectId,
    platform,
    fingerprintHash,
    developmentClient,
  }: {
    graphqlClient: ExpoGraphqlClient;
    projectId: string;
    platform: AppPlatform;
    fingerprintHash: string;
    developmentClient: boolean;
  }): Promise<BuildFragment> {
    const builds = await BuildQuery.viewBuildsOnAppAsync(graphqlClient, {
      appId: projectId,
      filter: {
        platform,
        fingerprintHash,
        status: BuildStatus.Finished,
        simulator: platform === AppPlatform.Ios ? true : undefined,
        distribution: platform === AppPlatform.Android ? DistributionType.Internal : undefined,
        developmentClient,
      },
      offset: 0,
      limit: 1,
    });
    if (builds.length === 0) {
      throw new Errors.CLIError(
        `No builds available for ${platform} with fingerprint hash ${fingerprintHash}`
      );
    }

    Log.succeed(`🎯 Found successful build with matching fingerprint on EAS servers.`);
    return builds[0];
  }

  async getPathToBuildArtifactAsync(build: BuildFragment, platform: AppPlatform): Promise<string> {
    const cachedBuildArtifactPath = getEasBuildRunCachedAppPath(
      build.project.id,
      build.id,
      platform
    );
    if (await pathExists(cachedBuildArtifactPath)) {
      Log.newLine();
      Log.log(`Using cached build...`);
      return cachedBuildArtifactPath;
    }

    if (!build.artifacts?.applicationArchiveUrl) {
      throw new Error('Build does not have an application archive url');
    }

    return await downloadAndMaybeExtractAppAsync(
      build.artifacts.applicationArchiveUrl,
      platform,
      cachedBuildArtifactPath
    );
  }
}

async function resolvePlatformAsync({
  nonInteractive,
  platform,
}: {
  nonInteractive: boolean;
  platform?: Platform;
}): Promise<AppPlatform> {
  if (nonInteractive && !platform) {
    throw new Error('Platform must be provided in non-interactive mode');
  }

  if (platform) {
    return toAppPlatform(platform);
  }

  const { selectedPlatform } = await promptAsync({
    type: 'select',
    message: 'Select platform',
    name: 'selectedPlatform',
    choices: [
      { title: 'Android', value: AppPlatform.Android },
      { title: 'iOS', value: AppPlatform.Ios },
    ],
  });
  return selectedPlatform;
}
