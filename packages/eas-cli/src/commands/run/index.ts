import { Errors, Flags } from '@oclif/core';

import { listAndSelectBuildsOnAppAsync } from '../../build/queries';
import { BuildDistributionType } from '../../build/types';
import EasCommand from '../../commandUtils/EasCommand';
import { EasPaginatedQueryFlags, getPaginatedQueryOptions } from '../../commandUtils/pagination';
import { AppPlatform, BuildStatus } from '../../graphql/generated';
import { RequestedPlatform, selectRequestedPlatformAsync } from '../../platform';
import { getDisplayNameForProjectIdAsync } from '../../project/projectUtils';
import { RunArchiveFlags, runAsync } from '../../run/run';
import { toGraphQLBuildDistribution } from '../build/list';

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
  requestedPlatform: RequestedPlatform;
  runArchiveFlags: RunArchiveFlags;
  limit?: number;
  offset?: number;
}

export default class Run extends EasCommand {
  static override description = 'run simulator build';

  static override flags = {
    latest: Flags.boolean({
      description: 'Run the latest simulator build for specified platform',
      exclusive: ['id', 'path', 'url'],
    }),
    url: Flags.string({
      description: 'Simulator build archive url',
      exclusive: ['latest', 'id', 'path'],
    }),
    path: Flags.string({
      description: 'Path to the simulator build file file',
      exclusive: ['latest', 'id', 'url'],
    }),
    id: Flags.string({
      description: 'ID of the simulator build to run',
      exclusive: ['latest, path, url'],
    }),
    platform: Flags.enum({
      char: 'p',
      options: ['android', 'ios', 'all'],
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
    const paginatedQueryOptions = getPaginatedQueryOptions(flags);
    const {
      loggedIn: { actor, graphqlClient },
      projectConfig: { projectId },
    } = await this.getContextAsync(Run, {
      nonInteractive: false,
    });

    if (
      !flags.runArchiveFlags.id &&
      !flags.runArchiveFlags.path &&
      !flags.runArchiveFlags.url &&
      !flags.runArchiveFlags.latest
    ) {
      await listAndSelectBuildsOnAppAsync(graphqlClient, {
        projectId,
        projectDisplayName: await getDisplayNameForProjectIdAsync(graphqlClient, projectId),
        filter: {
          platform: requestedPlatformToGraphqlAppPlatform(flags.requestedPlatform),
          distribution: toGraphQLBuildDistribution(BuildDistributionType.SIMULATOR),
          status: BuildStatus.Finished,
        },
        paginatedQueryOptions,
      });
    }

    await runAsync(graphqlClient, projectId, flags.runArchiveFlags, actor);
  }

  private async sanitizeFlagsAsync(flags: RawRunFlags): Promise<RunCommandFlags> {
    const { platform, limit, offset, ...runArchiveFlags } = flags;

    const requestedPlatform = await selectRequestedPlatformAsync(flags.platform);

    if (requestedPlatform === RequestedPlatform.All) {
      if (runArchiveFlags.id || runArchiveFlags.path || runArchiveFlags.url) {
        Errors.error(
          '--id, --path, and --url params are only supported when running a build for single-platform',
          { exit: 1 }
        );
      }
    }

    return {
      requestedPlatform,
      runArchiveFlags,
      limit,
      offset,
    };
  }
}

function requestedPlatformToGraphqlAppPlatform(
  requestedPlatform: RequestedPlatform
): AppPlatform | undefined {
  switch (requestedPlatform) {
    case RequestedPlatform.Android:
      return AppPlatform.Android;
    case RequestedPlatform.Ios:
      return AppPlatform.Ios;
    case RequestedPlatform.All:
      return undefined;
  }
}
