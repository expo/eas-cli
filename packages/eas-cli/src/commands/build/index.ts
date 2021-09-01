import { Workflow } from '@expo/eas-build-job';
import {
  EasJsonReader,
  hasMismatchedExtendsAsync,
  isUsingDeprecatedFormatAsync,
  migrateAsync,
} from '@expo/eas-json';
import { flags } from '@oclif/command';
import { error, exit } from '@oclif/errors';

import { prepareAndroidBuildAsync } from '../../build/android/build';
import { BuildRequestSender, waitForBuildEndAsync } from '../../build/build';
import { ensureProjectConfiguredAsync } from '../../build/configure';
import { BuildContext, createBuildContextAsync } from '../../build/context';
import { prepareIosBuildAsync } from '../../build/ios/build';
import { Platform, RequestedPlatform } from '../../build/types';
import { printBuildResults, printLogsUrls } from '../../build/utils/printBuildInfo';
import { ensureRepoIsCleanAsync } from '../../build/utils/repository';
import EasCommand from '../../commandUtils/EasCommand';
import { BuildFragment, BuildStatus } from '../../graphql/generated';
import Log from '../../log';
import {
  EAS_UNAVAILABLE_MESSAGE,
  isEasEnabledForProjectAsync,
} from '../../project/isEasEnabledForProject';
import { validateMetroConfigForManagedWorkflowAsync } from '../../project/metroConfig';
import { findProjectRootAsync } from '../../project/projectUtils';
import { confirmAsync, promptAsync } from '../../prompts';
import { enableJsonOutput } from '../../utils/json';
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
  json: boolean;
}

interface BuildFlags {
  requestedPlatform: RequestedPlatform;
  skipProjectConfiguration: boolean;
  profile: string;
  nonInteractive: boolean;
  local: boolean;
  wait: boolean;
  clearCache: boolean;
  json: boolean;
}

export default class Build extends EasCommand {
  static description = 'Start a build';

  static flags = {
    platform: flags.enum({ char: 'p', options: ['android', 'ios', 'all'] }),
    'skip-credentials-check': flags.boolean({
      default: false,
      hidden: true,
    }),
    json: flags.boolean({
      description: 'Enable JSON output, non-JSON messages will be printed to stderr',
      default: false,
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
    if (rawFlags.json) {
      enableJsonOutput();
    }
    const flags = await this.sanitizeFlagsAsync(rawFlags);
    const { requestedPlatform } = flags;

    const projectDir = (await findProjectRootAsync()) ?? process.cwd();
    await handleDeprecatedEasJsonAsync(projectDir, flags.nonInteractive);

    await vcs.ensureRepoExistsAsync();
    await ensureRepoIsCleanAsync(flags.nonInteractive);

    await ensureProjectConfiguredAsync(projectDir, requestedPlatform);

    const easJsonReader = new EasJsonReader(projectDir);
    const platformsToBuild = this.getPlatformsToBuild(requestedPlatform);

    const startedBuilds: BuildFragment[] = [];
    let metroConfigValidated = false;
    for (const platform of platformsToBuild) {
      const ctx = await createBuildContextAsync({
        buildProfileName: flags.profile,
        clearCache: flags.clearCache,
        buildProfile: await easJsonReader.readBuildProfileAsync(flags.profile, platform),
        local: flags.local,
        nonInteractive: flags.nonInteractive,
        platform,
        projectDir,
        skipProjectConfiguration: flags.skipProjectConfiguration,
      });

      if (ctx.workflow === Workflow.MANAGED && !metroConfigValidated) {
        await validateMetroConfigForManagedWorkflowAsync(ctx);
        metroConfigValidated = true;
      }

      if (!ctx.local && !(await isEasEnabledForProjectAsync(ctx.projectId))) {
        error(EAS_UNAVAILABLE_MESSAGE, { exit: 1 });
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
      printBuildResults(builds, flags.json);
      this.exitWithNonZeroCodeIfSomeBuildsFailed(builds);
    }
  }

  private async sanitizeFlagsAsync(flags: RawBuildFlags): Promise<BuildFlags> {
    const nonInteractive = flags['non-interactive'];
    if (!flags.platform && nonInteractive) {
      error('--platform is required when building in non-interactive mode', { exit: 1 });
    }
    if (flags.json && !nonInteractive) {
      error('--json is allowed only when building in non-interactive mode', { exit: 1 });
    }
    const requestedPlatform =
      (flags.platform as RequestedPlatform | undefined) ?? (await this.promptForPlatformAsync());

    if (flags.local) {
      if (requestedPlatform === RequestedPlatform.All) {
        error('Builds for multiple platforms are not supported with flag --local', { exit: 1 });
      } else if (process.platform !== 'darwin' && requestedPlatform === RequestedPlatform.Ios) {
        error('Unsupported platform, macOS is required to build apps for iOS', { exit: 1 });
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
      json: flags['json'],
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
      exit(1);
    }
  }
}

export async function handleDeprecatedEasJsonAsync(
  projectDir: string,
  nonInteractive: boolean
): Promise<void> {
  if (await isUsingDeprecatedFormatAsync(projectDir)) {
    const hasMismatchedExtendsKeys = await hasMismatchedExtendsAsync(projectDir);
    if (nonInteractive) {
      Log.error('We detected that your eas.json is using a deprecated format.');
      Log.error(
        'We will convert it automatically if run this command without --non-interactive flag. Alternatively, you can update eas.json manually according to https://docs.expo.dev/build/eas-json'
      );
      error('Unsupported eas.json format', { exit: 1 });
    }

    const confirm = await confirmAsync({
      message:
        'We detected that your eas.json is using a deprecated format, do you want to migrate to the new format?',
    });
    if (confirm) {
      await migrateAsync(projectDir);
      if (hasMismatchedExtendsKeys) {
        Log.warn(
          '"extends" keyword can only be migrated automatically to the new format if both Android and iOS profiles extend base profiles with the same names for both platforms'
        );
        Log.warn(
          'Migration was successful, but you need to manually adjust the extend rules for your profiles'
        );
        error('Fix eas.json manually', { exit: 1 });
      }
    } else {
      Log.error(
        "Aborting, update your eas.json according to https://docs.expo.dev/build/eas-json and run 'eas build' again"
      );
      error('Unsupported eas.json format', { exit: 1 });
    }
  }
}
