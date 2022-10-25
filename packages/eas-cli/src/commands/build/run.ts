import { Errors, Flags } from '@oclif/core';
import { existsSync } from 'fs-extra';
import assert from 'node:assert';

import { getLatestBuildAsync, listAndSelectBuildsOnAppAsync } from '../../build/queries';
import { BuildDistributionType } from '../../build/types';
import EasCommand from '../../commandUtils/EasCommand';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import {
  EasPaginatedQueryFlags,
  PaginatedQueryOptions,
  getPaginatedQueryOptions,
} from '../../commandUtils/pagination';
import { AppPlatform, BuildFragment, BuildStatus } from '../../graphql/generated';
import { BuildQuery } from '../../graphql/queries/BuildQuery';
import { getDisplayNameForProjectIdAsync } from '../../project/projectUtils';
import { promptAsync } from '../../prompts';
import { RunArchiveFlags, runAsync } from '../../run/run';
import { buildDistributionTypeToGraphQLDistributionType } from '../../utils/buildDistribution';
import { downloadAndExtractAppAsync, extractAppFromLocalArchiveAsync } from '../../utils/download';

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
      description: 'Path to the simulator/emulator build archive or simulator build app',
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

    if (
      runArchiveFlags.path &&
      !(
        (runArchiveFlags.path.endsWith('.tar.gz') ||
          runArchiveFlags.path.endsWith('.app') ||
          runArchiveFlags.path.endsWith('.apk')) &&
        existsSync(runArchiveFlags.path)
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
  if (flags.runArchiveFlags.id) {
    return BuildQuery.byIdAsync(graphqlClient, flags.runArchiveFlags.id);
  } else if (
    !flags.runArchiveFlags.id &&
    !flags.runArchiveFlags.path &&
    !flags.runArchiveFlags.url &&
    !flags.runArchiveFlags.latest
  ) {
    return await listAndSelectBuildsOnAppAsync(graphqlClient, {
      projectId,
      projectDisplayName: await getDisplayNameForProjectIdAsync(graphqlClient, projectId),
      filter: {
        platform: flags.selectedPlatform,
        distribution: buildDistributionTypeToGraphQLDistributionType(
          BuildDistributionType.SIMULATOR
        ),
        status: BuildStatus.Finished,
      },
      queryOptions: paginatedQueryOptions,
    });
  } else if (flags.runArchiveFlags.latest) {
    return await getLatestBuildAsync(graphqlClient, {
      projectId,
      filter: {
        platform: flags.selectedPlatform,
        distribution: buildDistributionTypeToGraphQLDistributionType(
          BuildDistributionType.SIMULATOR
        ),
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
  const appExtension = flags.selectedPlatform === AppPlatform.Ios ? 'app' : 'apk';

  if (maybeBuild) {
    if (!maybeBuild.artifacts?.applicationArchiveUrl) {
      throw new Error('Build does not have an application archive url');
    }

    return await downloadAndExtractAppAsync(
      maybeBuild.artifacts.applicationArchiveUrl,
      appExtension
    );
  }

  if (flags.runArchiveFlags.url) {
    return await downloadAndExtractAppAsync(flags.runArchiveFlags.url, appExtension);
  }

  if (flags.runArchiveFlags.path?.endsWith('.tar.gz')) {
    return await extractAppFromLocalArchiveAsync(flags.runArchiveFlags.path!, appExtension);
  }

  // this should never fail, due to the validation in sanitizeFlagsAsync
  assert(flags.runArchiveFlags.path);
  return flags.runArchiveFlags.path;
}
