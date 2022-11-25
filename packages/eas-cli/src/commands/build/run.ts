import { Errors, Flags } from '@oclif/core';
import { pathExists } from 'fs-extra';
import assert from 'node:assert';

import { getLatestBuildAsync, listAndSelectBuildsOnAppAsync } from '../../build/queries';
import EasCommand from '../../commandUtils/EasCommand';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import {
  EasPaginatedQueryFlags,
  PaginatedQueryOptions,
  getPaginatedQueryOptions,
} from '../../commandUtils/pagination';
import { AppPlatform, BuildFragment, BuildStatus, DistributionType } from '../../graphql/generated';
import { BuildQuery } from '../../graphql/queries/BuildQuery';
import { getDisplayNameForProjectIdAsync } from '../../project/projectUtils';
import { promptAsync } from '../../prompts';
import { RunArchiveFlags, runAsync } from '../../run/run';
import {
  downloadAndMaybeExtractAppAsync,
  extractAppFromLocalArchiveAsync,
} from '../../utils/download';

interface RawRunFlags {
  latest?: boolean;
  id?: string;
  url?: string;
  path?: string;
  platform?: string;
  limit?: number;
  offset?: number;
}

interface RunCommandFlags {
  selectedPlatform: AppPlatform;
  runArchiveFlags: RunArchiveFlags;
  limit?: number;
  offset?: number;
}

export default class Run extends EasCommand {
  static override hidden = true;

  static override description = 'run simulator/emulator builds from eas-cli';

  static override flags = {
    latest: Flags.boolean({
      description: 'Run the latest simulator/emulator build for specified platform',
      exclusive: ['id', 'path', 'url'],
    }),
    url: Flags.string({
      description: 'Simulator/Emulator build archive url',
      exclusive: ['latest', 'id', 'path'],
    }),
    path: Flags.string({
      description: 'Path to the simulator/emulator build archive or app',
      exclusive: ['latest', 'id', 'url'],
    }),
    id: Flags.string({
      description: 'ID of the simulator/emulator build to run',
      exclusive: ['latest, path, url'],
    }),
    platform: Flags.enum({
      char: 'p',
      options: ['android', 'ios'],
    }),
    ...EasPaginatedQueryFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.LoggedIn,
    ...this.ContextOptions.ProjectConfig,
    ...this.ContextOptions.ProjectDir,
  };

  async runAsync(): Promise<void> {
    const { flags: rawFlags } = await this.parse(Run);
    const flags = await this.sanitizeFlagsAsync(rawFlags);
    const queryOptions = getPaginatedQueryOptions(flags);
    const {
      loggedIn: { graphqlClient },
      projectConfig: { projectId },
    } = await this.getContextAsync(Run, {
      nonInteractive: false,
    });

    const simulatorBuildPath = await getPathToSimulatorBuildAppAsync(
      graphqlClient,
      projectId,
      flags,
      queryOptions
    );

    await runAsync(simulatorBuildPath, flags.selectedPlatform);
  }

  private async sanitizeFlagsAsync(flags: RawRunFlags): Promise<RunCommandFlags> {
    const { platform, limit, offset, ...runArchiveFlags } = flags;

    const selectedPlatform = await resolvePlatformAsync(platform);

    if (platform === 'ios' && process.platform !== 'darwin') {
      Errors.error('You can only use an iOS simulator to run apps on macOS devices', {
        exit: 1,
      });
    }

    if (
      runArchiveFlags.path &&
      !(
        (runArchiveFlags.path.endsWith('.tar.gz') ||
          runArchiveFlags.path.endsWith('.app') ||
          runArchiveFlags.path.endsWith('.apk')) &&
        (await pathExists(runArchiveFlags.path))
      )
    ) {
      Errors.error('The path must point to a .tar.gz archive, .apk file, or .app directory', {
        exit: 1,
      });
    }

    return {
      selectedPlatform,
      runArchiveFlags,
      limit,
      offset,
    };
  }
}

async function resolvePlatformAsync(platform?: string): Promise<AppPlatform> {
  if (process.platform !== 'darwin') {
    return AppPlatform.Android;
  }

  if (platform && Object.values(AppPlatform).includes(platform.toUpperCase() as AppPlatform)) {
    return platform.toUpperCase() as AppPlatform;
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

async function maybeGetBuildAsync(
  graphqlClient: ExpoGraphqlClient,
  flags: RunCommandFlags,
  projectId: string,
  paginatedQueryOptions: PaginatedQueryOptions
): Promise<BuildFragment | null> {
  const distributionType =
    flags.selectedPlatform === AppPlatform.Ios ? DistributionType.Simulator : undefined;

  if (flags.runArchiveFlags.id) {
    return BuildQuery.byIdAsync(graphqlClient, flags.runArchiveFlags.id);
  } else if (
    !flags.runArchiveFlags.id &&
    !flags.runArchiveFlags.path &&
    !flags.runArchiveFlags.url &&
    !flags.runArchiveFlags.latest
  ) {
    return await listAndSelectBuildsOnAppAsync(graphqlClient, flags.selectedPlatform, {
      projectId,
      projectDisplayName: await getDisplayNameForProjectIdAsync(graphqlClient, projectId),
      filter: {
        platform: flags.selectedPlatform,
        distribution: distributionType,
        status: BuildStatus.Finished,
      },
      queryOptions: paginatedQueryOptions,
      selectPromptDisabledFunction: build =>
        build.platform === AppPlatform.Ios
          ? false
          : !build.artifacts?.applicationArchiveUrl?.endsWith('.apk') ?? false,
      warningMessage: 'This is not a simulator/emulator build',
    });
  } else if (flags.runArchiveFlags.latest) {
    return await getLatestBuildAsync(graphqlClient, {
      projectId,
      filter: {
        platform: flags.selectedPlatform,
        distribution: distributionType,
        status: BuildStatus.Finished,
      },
    });
  } else {
    return null;
  }
}

async function getPathToSimulatorBuildAppAsync(
  graphqlClient: ExpoGraphqlClient,
  projectId: string,
  flags: RunCommandFlags,
  queryOptions: PaginatedQueryOptions
): Promise<string> {
  const maybeBuild = await maybeGetBuildAsync(graphqlClient, flags, projectId, queryOptions);

  if (maybeBuild) {
    if (!maybeBuild.artifacts?.applicationArchiveUrl) {
      throw new Error('Build does not have an application archive url');
    }

    return await downloadAndMaybeExtractAppAsync(
      maybeBuild.artifacts.applicationArchiveUrl,
      flags.selectedPlatform
    );
  }

  if (flags.runArchiveFlags.url) {
    return await downloadAndMaybeExtractAppAsync(flags.runArchiveFlags.url, flags.selectedPlatform);
  }

  if (flags.runArchiveFlags.path?.endsWith('.tar.gz')) {
    return await extractAppFromLocalArchiveAsync(
      flags.runArchiveFlags.path,
      flags.selectedPlatform
    );
  }

  // this should never fail, due to the validation in sanitizeFlagsAsync
  assert(flags.runArchiveFlags.path);
  return flags.runArchiveFlags.path;
}
