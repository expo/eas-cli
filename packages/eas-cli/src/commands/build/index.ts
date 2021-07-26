import { EasJsonReader } from '@expo/eas-json';
import { flags } from '@oclif/command';

import { prepareAndroidBuildAsync } from '../../build/android/build';
import { BuildRequestSender, waitForBuildEndAsync } from '../../build/build';
import { ensureProjectConfiguredAsync } from '../../build/configure';
import { BuildContext, createBuildContextAsync } from '../../build/context';
import { prepareIosBuildAsync } from '../../build/ios/build';
import { Platform, RequestedPlatform } from '../../build/types';
import { printBuildResults, printLogsUrls } from '../../build/utils/printBuildInfo';
import { ensureRepoIsCleanAsync } from '../../build/utils/repository';
import EasCommand from '../../commandUtils/EasCommand';
import { ExitError } from '../../error/ExitError';
import { BuildFragment, BuildStatus } from '../../graphql/generated';
import Log from '../../log';
import {
  EAS_UNAVAILABLE_MESSAGE,
  isEasEnabledForProjectAsync,
} from '../../project/isEasEnabledForProject';
import { findProjectRootAsync } from '../../project/projectUtils';
import { promptAsync } from '../../prompts';
import vcs from '../../vcs';

interface RawBuildFlags {
  platform?: string;
  'skip-credentials-check': boolean;
  'skip-project-configuration': boolean;
  profile: string;
  'non-interactive': boolean;
  local: boolean;
  wait: boolean;
  'clear-cache': boolean;
}

interface BuildFlags {
  requestedPlatform: RequestedPlatform;
  skipProjectConfiguration: boolean;
  profile: string;
  nonInteractive: boolean;
  local: boolean;
  wait: boolean;
  clearCache: boolean;
}

export default class Build extends EasCommand {
  static description = 'Start a build';

  static flags = {
    platform: flags.enum({ char: 'p', options: ['android', 'ios', 'all'] }),
    'skip-credentials-check': flags.boolean({
      default: false,
      hidden: true,
    }),
    'skip-project-configuration': flags.boolean({
      default: false,
      description: 'Skip project configuration',
    }),
    profile: flags.string({
      default: 'release',
      description: 'Name of the build profile from eas.json',
    }),
    'non-interactive': flags.boolean({
      default: false,
      description: 'Run command in --non-interactive mode',
    }),
    local: flags.boolean({
      default: false,
      description: 'Run build locally [experimental]',
    }),
    wait: flags.boolean({
      default: true,
      allowNo: true,
      description: 'Wait for build(s) to complete',
    }),
    'clear-cache': flags.boolean({
      default: false,
      description: 'Clear cache before the build',
    }),
  };

  async run(): Promise<void> {
    const { flags: rawFlags } = this.parse(Build);

    try {
      const flags = await this.sanitizeFlagsAsync(rawFlags);
      const { requestedPlatform } = flags;

      await vcs.ensureRepoExistsAsync();
      await ensureRepoIsCleanAsync(flags.nonInteractive);

      const projectDir = (await findProjectRootAsync()) ?? process.cwd();
      await ensureProjectConfiguredAsync(projectDir, requestedPlatform);

      const easConfig = await new EasJsonReader(projectDir, requestedPlatform).readAsync(
        flags.profile
      );
      const platformsToBuild = this.getPlatformsToBuild(requestedPlatform);

      const startedBuilds: BuildFragment[] = [];
      for (const platform of platformsToBuild) {
        const ctx = await createBuildContextAsync({
          buildProfileName: flags.profile,
          clearCache: flags.clearCache,
          easConfig,
          local: flags.local,
          nonInteractive: flags.nonInteractive,
          platform,
          projectDir,
          skipProjectConfiguration: flags.skipProjectConfiguration,
        });

        if (!ctx.local && !(await isEasEnabledForProjectAsync(ctx.projectId))) {
          throw new ExitError(EAS_UNAVAILABLE_MESSAGE);
        }

        const maybeBuild = await this.startBuildAsync(ctx);
        if (maybeBuild) {
          startedBuilds.push(maybeBuild);
        }
      }
      if (flags.local) {
        return;
      }

      Log.newLine();
      printLogsUrls(startedBuilds);
      Log.newLine();

      if (flags.wait) {
        const builds = await waitForBuildEndAsync(startedBuilds.map(build => build.id));
        printBuildResults(builds);
        this.exitWithNonZeroCodeIfSomeBuildsFailed(builds);
      }
    } catch (err) {
      if (err instanceof ExitError) {
        if (err.message) {
          Log.error(err.message);
        }
        process.exitCode = err.errorCode;
        return;
      }
      throw err;
    }
  }

  private async sanitizeFlagsAsync(flags: RawBuildFlags): Promise<BuildFlags> {
    const nonInteractive = flags['non-interactive'];
    if (!flags.platform && nonInteractive) {
      throw new Error('--platform is required when building in non-interactive mode');
    }
    const requestedPlatform =
      (flags.platform as RequestedPlatform | undefined) ?? (await this.promptForPlatformAsync());

    if (flags.local) {
      if (requestedPlatform === RequestedPlatform.All) {
        throw new ExitError('Builds for multiple platforms are not supported with flag --local');
      } else if (process.platform !== 'darwin' && requestedPlatform === RequestedPlatform.Ios) {
        throw new ExitError('Unsupported platform, macOS is required to build apps for iOS');
      }
    }

    if (flags['skip-credentials-check']) {
      Log.warnDeprecatedFlag(
        'skip-credentials-check',
        'Build credentials validation is always skipped with the --non-interactive flag. You can also skip interactively.'
      );
      Log.newLine();
    }

    return {
      requestedPlatform,
      skipProjectConfiguration: flags['skip-project-configuration'],
      profile: flags['profile'],
      nonInteractive,
      local: flags['local'],
      wait: flags['wait'],
      clearCache: flags['clear-cache'],
    };
  }

  private async promptForPlatformAsync(): Promise<RequestedPlatform> {
    const { platform } = await promptAsync({
      type: 'select',
      message: 'Build for platforms',
      name: 'platform',
      choices: [
        { title: 'All', value: RequestedPlatform.All },
        { title: 'iOS', value: RequestedPlatform.Ios },
        { title: 'Android', value: RequestedPlatform.Android },
      ],
    });
    return platform;
  }

  private getPlatformsToBuild(requestedPlatform: RequestedPlatform): Platform[] {
    if (requestedPlatform === RequestedPlatform.All) {
      return [Platform.ANDROID, Platform.IOS];
    } else if (requestedPlatform === RequestedPlatform.Android) {
      return [Platform.ANDROID];
    } else {
      return [Platform.IOS];
    }
  }

  private async startBuildAsync(ctx: BuildContext<Platform>): Promise<BuildFragment | undefined> {
    let sendBuildRequestAsync: BuildRequestSender;
    if (ctx.platform === Platform.ANDROID) {
      sendBuildRequestAsync = await prepareAndroidBuildAsync(ctx as BuildContext<Platform.ANDROID>);
    } else {
      sendBuildRequestAsync = await prepareIosBuildAsync(ctx as BuildContext<Platform.IOS>);
    }
    return await sendBuildRequestAsync();
  }

  private exitWithNonZeroCodeIfSomeBuildsFailed(maybeBuilds: (BuildFragment | null)[]): void {
    const failedBuilds = (maybeBuilds.filter(i => i) as BuildFragment[]).filter(
      i => i.status === BuildStatus.Errored
    );
    if (failedBuilds.length > 0) {
      throw new ExitError();
    }
  }
}
