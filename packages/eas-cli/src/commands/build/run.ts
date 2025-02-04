import { Errors, Flags } from '@oclif/core';
import assert from 'assert';
import { pathExists } from 'fs-extra';

import { getLatestBuildAsync, listAndSelectBuildOnAppAsync } from '../../build/queries';
import EasCommand from '../../commandUtils/EasCommand';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import {
  EasPaginatedQueryFlags,
  PaginatedQueryOptions,
  getPaginatedQueryOptions,
} from '../../commandUtils/pagination';
import { AppPlatform, BuildFragment, BuildStatus } from '../../graphql/generated';
import { BuildQuery } from '../../graphql/queries/BuildQuery';
import Log from '../../log';
import { appPlatformDisplayNames } from '../../platform';
import { getDisplayNameForProjectIdAsync } from '../../project/projectUtils';
import { promptAsync } from '../../prompts';
import { RunArchiveFlags, getEasBuildRunCachedAppPath, runAsync } from '../../run/run';
import { isRunnableOnSimulatorOrEmulator } from '../../run/utils';
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
  profile?: string;
}

interface RunCommandFlags {
  selectedPlatform: AppPlatform;
  runArchiveFlags: RunArchiveFlags;
  limit?: number;
  offset?: number;
  profile?: string;
}

export default class Run extends EasCommand {
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
    profile: Flags.string({
      char: 'e',
      description:
        'Name of the build profile used to create the build to run. When specified, only builds created with the specified build profile will be queried.',
      helpValue: 'PROFILE_NAME',
    }),
    ...EasPaginatedQueryFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.LoggedIn,
    ...this.ContextOptions.ProjectId,
    ...this.ContextOptions.Vcs,
  };

  async runAsync(): Promise<void> {
    const { flags: rawFlags } = await this.parse(Run);
    const flags = await this.sanitizeFlagsAsync(rawFlags);
    const queryOptions = getPaginatedQueryOptions(flags);
    const {
      loggedIn: { graphqlClient },
      projectId,
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
    const { platform, limit, offset, profile, ...runArchiveFlags } = flags;

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

    if (profile && (runArchiveFlags.id || runArchiveFlags.path || runArchiveFlags.url)) {
      Log.warn('The --profile flag is ignored when using --id, --path, or --url flags.');
    }

    return {
      selectedPlatform,
      runArchiveFlags,
      limit,
      offset,
      profile,
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

function validateChosenBuild(
  maybeBuild: BuildFragment | null,
  selectedPlatform: AppPlatform
): BuildFragment {
  if (!maybeBuild) {
    throw new Error('There are no simulator/emulator builds that can be run for this project.');
  }

  if (selectedPlatform !== maybeBuild.platform) {
    throw new Error(
      `The selected build is for ${
        appPlatformDisplayNames[maybeBuild.platform]
      }, but you selected ${appPlatformDisplayNames[selectedPlatform]}`
    );
  }

  if (maybeBuild.status !== BuildStatus.Finished) {
    throw new Error('The selected build is not finished.');
  }

  if (!isRunnableOnSimulatorOrEmulator(maybeBuild)) {
    throw new Error(
      'Artifacts for the latest build have expired and are no longer available, or this is not a simulator/emulator build.'
    );
  }

  return maybeBuild;
}

async function maybeGetBuildAsync(
  graphqlClient: ExpoGraphqlClient,
  flags: RunCommandFlags,
  projectId: string,
  paginatedQueryOptions: PaginatedQueryOptions
): Promise<BuildFragment | null> {
  const simulator = flags.selectedPlatform === AppPlatform.Ios ? true : undefined;

  if (flags.runArchiveFlags.id) {
    const build = await BuildQuery.byIdAsync(graphqlClient, flags.runArchiveFlags.id);
    return validateChosenBuild(build, flags.selectedPlatform);
  } else if (
    !flags.runArchiveFlags.id &&
    !flags.runArchiveFlags.path &&
    !flags.runArchiveFlags.url &&
    !flags.runArchiveFlags.latest
  ) {
    const build = await listAndSelectBuildOnAppAsync(graphqlClient, {
      projectId,
      title: `Select ${appPlatformDisplayNames[flags.selectedPlatform]} ${
        flags.selectedPlatform === AppPlatform.Ios ? 'simulator' : 'emulator'
      } build to run for ${await getDisplayNameForProjectIdAsync(graphqlClient, projectId)} app`,
      filter: {
        platform: flags.selectedPlatform,
        status: BuildStatus.Finished,
        buildProfile: flags.profile,
        simulator,
      },
      paginatedQueryOptions,
      selectPromptDisabledFunction: build => !isRunnableOnSimulatorOrEmulator(build),
      selectPromptWarningMessage: `Artifacts for this build have expired and are no longer available, or this is not ${
        flags.selectedPlatform === AppPlatform.Ios ? 'a simulator' : 'an emulator'
      } build.`,
    });
    return validateChosenBuild(build, flags.selectedPlatform);
  } else if (flags.runArchiveFlags.latest) {
    const latestBuild = await getLatestBuildAsync(graphqlClient, {
      projectId,
      filter: {
        platform: flags.selectedPlatform,
        status: BuildStatus.Finished,
        buildProfile: flags.profile,
        simulator,
      },
    });

    return validateChosenBuild(latestBuild, flags.selectedPlatform);
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
    const cachedAppPath = getEasBuildRunCachedAppPath(
      projectId,
      maybeBuild.id,
      flags.selectedPlatform
    );

    if (await pathExists(cachedAppPath)) {
      Log.newLine();
      Log.log(`Using cached app...`);
      return cachedAppPath;
    }

    if (!maybeBuild.artifacts?.applicationArchiveUrl) {
      throw new Error('Build does not have an application archive url');
    }

    return await downloadAndMaybeExtractAppAsync(
      maybeBuild.artifacts.applicationArchiveUrl,
      flags.selectedPlatform,
      cachedAppPath
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
