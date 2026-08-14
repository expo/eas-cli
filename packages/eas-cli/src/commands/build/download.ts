import { Platform } from '@expo/eas-build-job';
import { Flags } from '@oclif/core';
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';

import EasCommand from '../../commandUtils/EasCommand';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import {
  EasNonInteractiveAndJsonFlags,
  resolveNonInteractiveAndJsonFlags,
} from '../../commandUtils/flags';
import { AppPlatform, BuildFragment, BuildStatus, DistributionType } from '../../graphql/generated';
import { BuildQuery } from '../../graphql/queries/BuildQuery';
import { toAppPlatform } from '../../graphql/types/AppPlatform';
import Log from '../../log';
import { promptAsync } from '../../prompts';
import { getEasBuildRunCachedAppPath } from '../../run/run';
import {
  downloadAndMaybeExtractAppAsync,
  downloadFileWithProgressTrackerAsync,
} from '../../utils/download';
import { formatBytes } from '../../utils/files';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';
import { getEasBuildRunCacheDirectoryPath } from '../../utils/paths';

export default class Download extends EasCommand {
  static override description =
    'download a simulator/emulator build by build ID or fingerprint hash';


  static override flags = {
    'build-id': Flags.string({
      aliases: ['id'],
      description:
        'ID of the build to download. Mutually exclusive with --fingerprint, --platform, and --dev-client; the platform is derived from the build itself.',
      exclusive: ['fingerprint', 'platform', 'dev-client'],
    }),
    fingerprint: Flags.string({
      description: 'Fingerprint hash of the build to download',
      exclusive: ['build-id'],
    }),
    platform: Flags.option({
      char: 'p',
      options: [Platform.IOS, Platform.ANDROID] as const,
      exclusive: ['build-id'],
    })(),
    'dev-client': Flags.boolean({
      description: 'Filter only dev-client builds.',
      allowNo: true,
      exclusive: ['build-id'],
    }),
    'all-artifacts': Flags.boolean({
      description:
        'Download all available build artifacts (build artifacts archive, Xcode logs, etc.) in addition to the application archive. Without this flag, only the application archive is downloaded and the command errors if it is missing.',
      default: false,
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
        'build-id': buildId,
        platform,
        fingerprint,
        'dev-client': developmentClient,
        'all-artifacts': allArtifacts,
        ...rawFlags
      },
    } = await this.parse(Download);
    const { json: jsonFlag, nonInteractive } = resolveNonInteractiveAndJsonFlags(rawFlags);

    if (!buildId && !fingerprint) {
      throw new Error('Either --build-id or --fingerprint is required.');
    }

    const {
      loggedIn: { graphqlClient },
      projectId,
    } = await this.getContextAsync(Download, {
      nonInteractive,
    });

    if (jsonFlag) {
      enableJsonOutput();
    }

    let build: BuildFragment;
    let selectedPlatform: AppPlatform;
    if (buildId) {
      build = await this.getBuildByIdAsync({ graphqlClient, buildId });
      selectedPlatform = build.platform;
      Log.succeed(`🎯 Found build ${chalk.bold(buildId)} on EAS servers.`);
    } else {
      selectedPlatform = await resolvePlatformAsync({ nonInteractive, platform });
      build = await this.getBuildByFingerprintAsync({
        graphqlClient,
        projectId,
        platform: selectedPlatform,
        fingerprintHash: fingerprint!,
        developmentClient,
      });
    }

    let buildArtifactPath: string | null = null;
    if (build.artifacts?.applicationArchiveUrl) {
      buildArtifactPath = await this.getPathToBuildArtifactAsync(build, selectedPlatform);
    } else if (!allArtifacts) {
      const availableArtifacts = listAvailableExtraArtifactNames(build);
      if (availableArtifacts.length > 0) {
        throw new Error(
          `Build does not have an application archive url. Other artifacts are available (${availableArtifacts.join(', ')}); re-run with --all-artifacts to download them.`
        );
      }
      throw new Error('Build does not have an application archive url');
    }

    let extraArtifactPaths: Record<string, string> = {};
    if (allArtifacts) {
      extraArtifactPaths = await this.downloadExtraArtifactsAsync(build);
    }

    if (jsonFlag) {
      const jsonResults = {
        ...(buildArtifactPath != null && { path: buildArtifactPath }),
        ...extraArtifactPaths,
      };
      printJsonOnlyOutput(jsonResults);
    } else {
      if (buildArtifactPath != null) {
        Log.log(`Build downloaded to ${chalk.bold(buildArtifactPath)}`);
      }
      for (const [name, filePath] of Object.entries(extraArtifactPaths)) {
        Log.log(`${name} downloaded to ${chalk.bold(filePath)}`);
      }
    }
  }

  private async downloadExtraArtifactsAsync(build: BuildFragment): Promise<Record<string, string>> {
    const artifacts = build.artifacts;
    if (!artifacts) {
      return {};
    }

    const extraArtifacts: Array<{ name: string; url: string }> = [];
    if (artifacts.buildArtifactsUrl) {
      extraArtifacts.push({ name: 'buildArtifacts', url: artifacts.buildArtifactsUrl });
    }
    if (artifacts.xcodeBuildLogsUrl) {
      extraArtifacts.push({ name: 'xcodeBuildLogs', url: artifacts.xcodeBuildLogsUrl });
    }
    if (artifacts.buildUrl && artifacts.buildUrl !== artifacts.applicationArchiveUrl) {
      extraArtifacts.push({ name: 'build', url: artifacts.buildUrl });
    }

    if (extraArtifacts.length === 0) {
      return {};
    }

    const outputDir = path.join(getEasBuildRunCacheDirectoryPath(), `${build.id}-artifacts`);
    await fs.ensureDir(outputDir);

    const downloaded: Record<string, string> = {};
    for (const { name, url } of extraArtifacts) {
      const fileName = getFileNameFromUrl(url, name);
      const outputPath = path.join(outputDir, fileName);
      await downloadFileWithProgressTrackerAsync(
        url,
        outputPath,
        (ratio, total) =>
          `Downloading ${name} (${formatBytes(total * ratio)} / ${formatBytes(total)})`,
        `Successfully downloaded ${name}`
      );
      downloaded[name] = outputPath;
    }

    return downloaded;
  }

  private async getBuildByIdAsync({
    graphqlClient,
    buildId,
  }: {
    graphqlClient: ExpoGraphqlClient;
    buildId: string;
  }): Promise<BuildFragment> {
    try {
      return await BuildQuery.byIdAsync(graphqlClient, buildId);
    } catch (error: any) {
      throw new Error(`Could not find build with ID ${buildId}: ${error.message}`);
    }
  }

  private async getBuildByFingerprintAsync({
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
      throw new Error(
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
    if (await fs.pathExists(cachedBuildArtifactPath)) {
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

function listAvailableExtraArtifactNames(build: BuildFragment): string[] {
  const names: string[] = [];
  if (build.artifacts?.buildArtifactsUrl) {
    names.push('buildArtifacts');
  }
  if (build.artifacts?.xcodeBuildLogsUrl) {
    names.push('xcodeBuildLogs');
  }
  if (
    build.artifacts?.buildUrl &&
    build.artifacts.buildUrl !== build.artifacts.applicationArchiveUrl
  ) {
    names.push('build');
  }
  return names;
}

function getFileNameFromUrl(url: string, fallbackName: string): string {
  try {
    const pathname = new URL(url).pathname;
    const basename = path.basename(pathname);
    if (basename) {
      return basename;
    }
  } catch {
    // fall through to default
  }
  return fallbackName;
}
