import { Flags } from '@oclif/core';

import { BUILDS_LIMIT, listAndRenderBuildsOnAppAsync } from '../../build/queries';
import { BuildDistributionType, BuildStatus } from '../../build/types';
import EasCommand from '../../commandUtils/EasCommand';
import { EasNonInteractiveAndJsonFlags } from '../../commandUtils/flags';
import {
  EasPaginatedQueryFlags,
  getLimitFlagWithCustomValues,
  getPaginatedQueryOptions,
} from '../../commandUtils/pagination';
import { AppPlatform, BuildStatus as GraphQLBuildStatus } from '../../graphql/generated';
import Log from '../../log';
import { RequestedPlatform } from '../../platform';
import { getDisplayNameForProjectIdAsync } from '../../project/projectUtils';
import { buildDistributionTypeToGraphQLDistributionType } from '../../utils/buildDistribution';
import { enableJsonOutput } from '../../utils/json';

export default class BuildList extends EasCommand {
  static override description = 'list all builds for your project';

  static override flags = {
    platform: Flags.enum({
      options: Object.values(RequestedPlatform),
      char: 'p',
    }),
    status: Flags.enum({
      options: Object.values(BuildStatus),
      description: 'Filter only builds with the specified status',
    }),
    distribution: Flags.enum({
      options: Object.values(BuildDistributionType),
      description: 'Filter only builds with the specified distribution type',
    }),
    channel: Flags.string(),
    'app-version': Flags.string({
      aliases: ['appVersion'],
      description: 'Filter only builds created with the specified main app version',
    }),
    'app-build-version': Flags.string({
      aliases: ['appBuildVersion'],
      description: 'Filter only builds created with the specified app build version',
    }),
    'sdk-version': Flags.string({
      aliases: ['sdkVersion'],
      description: 'Filter only builds created with the specified Expo SDK version',
    }),
    'runtime-version': Flags.string({
      aliases: ['runtimeVersion'],
      description: 'Filter only builds created with the specified runtime version',
    }),
    'app-identifier': Flags.string({
      aliases: ['appIdentifier'],
      description: 'Filter only builds created with the specified app identifier',
    }),
    'build-profile': Flags.string({
      char: 'e',
      aliases: ['profile', 'buildProfile'],
      description: 'Filter only builds created with the specified build profile',
    }),
    'git-commit-hash': Flags.string({
      aliases: ['gitCommitHash'],
      description: 'Filter only builds created with the specified git commit hash',
    }),
    'fingerprint-hash': Flags.string({
      description: 'Filter only builds with the specified fingerprint hash',
    }),
    ...EasPaginatedQueryFlags,
    limit: getLimitFlagWithCustomValues({ defaultTo: 10, limit: BUILDS_LIMIT }),
    ...EasNonInteractiveAndJsonFlags,
    simulator: Flags.boolean({
      description:
        'Filter only iOS simulator builds. Can only be used with --platform flag set to "ios"',
    }),
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectId,
    ...this.ContextOptions.LoggedIn,
    ...this.ContextOptions.Vcs,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(BuildList);
    const paginatedQueryOptions = getPaginatedQueryOptions(flags);
    const {
      json: jsonFlag,
      platform: requestedPlatform,
      status: buildStatus,
      distribution: buildDistribution,
      'non-interactive': nonInteractive,
    } = flags;
    if (buildDistribution === BuildDistributionType.SIMULATOR) {
      Log.warn(
        `Using --distribution flag with "simulator" value is deprecated - use --simulator flag instead`
      );
    }
    if (flags.simulator && requestedPlatform !== RequestedPlatform.Ios) {
      Log.error(
        `The --simulator flag is only usable with --platform flag set to "ios", as it is used to filter specifically iOS simulator builds`
      );
      process.exit(1);
    }
    const {
      projectId,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(BuildList, {
      nonInteractive,
    });
    if (jsonFlag) {
      enableJsonOutput();
    }

    const platform = toAppPlatform(requestedPlatform);
    const graphqlBuildStatus = toGraphQLBuildStatus(buildStatus);
    const graphqlBuildDistribution =
      buildDistributionTypeToGraphQLDistributionType(buildDistribution);
    const displayName = await getDisplayNameForProjectIdAsync(graphqlClient, projectId);

    await listAndRenderBuildsOnAppAsync(graphqlClient, {
      projectId,
      projectDisplayName: displayName,
      filter: {
        platform,
        status: graphqlBuildStatus,
        distribution: graphqlBuildDistribution,
        channel: flags.channel,
        appVersion: flags['app-version'],
        appBuildVersion: flags['app-build-version'],
        sdkVersion: flags['sdk-version'],
        runtimeVersion: flags['runtime-version'],
        appIdentifier: flags['app-identifier'],
        buildProfile: flags['build-profile'],
        gitCommitHash: flags['git-commit-hash'],
        simulator: flags.simulator,
        fingerprintHash: flags['fingerprint-hash'],
      },
      paginatedQueryOptions,
    });
  }
}

const toAppPlatform = (requestedPlatform?: RequestedPlatform): AppPlatform | undefined => {
  if (!requestedPlatform || requestedPlatform === RequestedPlatform.All) {
    return undefined;
  } else if (requestedPlatform === RequestedPlatform.Android) {
    return AppPlatform.Android;
  } else {
    return AppPlatform.Ios;
  }
};

const toGraphQLBuildStatus = (buildStatus?: BuildStatus): GraphQLBuildStatus | undefined => {
  if (!buildStatus) {
    return undefined;
  } else if (buildStatus === BuildStatus.NEW) {
    return GraphQLBuildStatus.New;
  } else if (buildStatus === BuildStatus.IN_QUEUE) {
    return GraphQLBuildStatus.InQueue;
  } else if (buildStatus === BuildStatus.IN_PROGRESS) {
    return GraphQLBuildStatus.InProgress;
  } else if (buildStatus === BuildStatus.PENDING_CANCEL) {
    return GraphQLBuildStatus.PendingCancel;
  } else if (buildStatus === BuildStatus.ERRORED) {
    return GraphQLBuildStatus.Errored;
  } else if (buildStatus === BuildStatus.FINISHED) {
    return GraphQLBuildStatus.Finished;
  } else {
    return GraphQLBuildStatus.Canceled;
  }
};
