import { Platform, Workflow } from '@expo/eas-build-job';
import {
  EasJsonReader,
  hasMismatchedExtendsAsync,
  isUsingDeprecatedFormatAsync,
  migrateAsync,
} from '@expo/eas-json';
import { flags } from '@oclif/command';
import { error } from '@oclif/errors';
import chalk from 'chalk';

import { prepareAndroidBuildAsync } from '../../build/android/build';
import { BuildRequestSender, waitForBuildEndAsync } from '../../build/build';
import { ensureProjectConfiguredAsync } from '../../build/configure';
import { BuildContext, createBuildContextAsync } from '../../build/context';
import { prepareIosBuildAsync } from '../../build/ios/build';
import { printBuildResults, printLogsUrls } from '../../build/utils/printBuildInfo';
import { ensureRepoIsCleanAsync } from '../../build/utils/repository';
import EasCommand from '../../commandUtils/EasCommand';
import { BuildFragment, BuildStatus, SubmissionFragment } from '../../graphql/generated';
import { toAppPlatform, toPlatform } from '../../graphql/types/AppPlatform';
import Log from '../../log';
import {
  RequestedPlatform,
  appPlatformDisplayNames,
  appPlatformEmojis,
  selectRequestedPlatformAsync,
  toPlatforms,
} from '../../platform';
import {
  EAS_UNAVAILABLE_MESSAGE,
  isEasEnabledForProjectAsync,
} from '../../project/isEasEnabledForProject';
import { validateMetroConfigForManagedWorkflowAsync } from '../../project/metroConfig';
import { findProjectRootAsync } from '../../project/projectUtils';
import { confirmAsync } from '../../prompts';
import { createSubmissionContext } from '../../submissions/context';
import {
  submitAsync,
  waitToCompleteAsync as waitForSubmissionsToCompleteAsync,
} from '../../submissions/submit';
import { printSubmissionDetailsUrls } from '../../submissions/utils/urls';
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
  submit: boolean;
  'submit-with-profile'?: string;
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
  submit: boolean;
  submitProfile?: string;
}

export default class Build extends EasCommand {
  static description = 'start a build';

  static flags = {
    platform: flags.enum({
      char: 'p',
      options: ['android', 'ios', 'all'],
    }),
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
      helpValue: 'PROFILE_NAME',
    }),
    'non-interactive': flags.boolean({
      default: false,
      description: 'Run command in non-interactive mode',
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
    submit: flags.boolean({
      default: false,
      description:
        'Submit on build complete using the submit profile with the same name as the build profile',
      exclusive: ['submit-with-profile'],
    }),
    'submit-with-profile': flags.string({
      description: 'Submit on build complete using the submit profile with provided name',
      helpValue: 'PROFILE_NAME',
      exclusive: ['submit'],
    }),
  };

  private metroConfigValidated = false;

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

    const platforms = toPlatforms(requestedPlatform);

    const startedBuilds: BuildFragment[] = [];
    for (const platform of platforms) {
      const maybeBuild = await this.prepareAndStartBuildAsync({
        projectDir,
        platform,
        flags,
        moreBuilds: platforms.length > 1,
      });
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

    const submissions: SubmissionFragment[] = [];
    if (flags.submit) {
      for (const build of startedBuilds) {
        const submission = await this.prepareAndStartSubmissionAsync({
          projectDir,
          build,
          flags,
          moreBuilds: startedBuilds.length > 1,
        });
        submissions.push(submission);
      }

      Log.newLine();
      printSubmissionDetailsUrls(submissions);
    }

    if (!flags.wait) {
      return;
    }

    const builds = await waitForBuildEndAsync(startedBuilds.map(build => build.id));
    printBuildResults(builds, flags.json);

    if (!flags.submit) {
      this.exitWithNonZeroCodeIfSomeBuildsFailed(builds);
    } else {
      // the following function also exits with non zero code if any of the submissions failed
      await waitForSubmissionsToCompleteAsync(submissions);
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

    const requestedPlatform = await selectRequestedPlatformAsync(flags.platform);
    if (flags.local) {
      if (flags.submit || flags['submit-with-profile'] !== undefined) {
        // TODO: implement this
        error('Auto-submits are not yet supported when building locally', { exit: 1 });
      }

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

    const profile = flags['profile'];
    return {
      requestedPlatform,
      skipProjectConfiguration: flags['skip-project-configuration'],
      profile,
      nonInteractive,
      local: flags['local'],
      wait: flags['wait'],
      clearCache: flags['clear-cache'],
      json: flags['json'],
      submit: flags['submit'],
      submitProfile: flags['submit-with-profile'] ?? profile,
    };
  }

  private async prepareAndStartBuildAsync({
    projectDir,
    platform,
    flags,
    moreBuilds,
  }: {
    projectDir: string;
    platform: Platform;
    flags: BuildFlags;
    moreBuilds: boolean;
  }): Promise<BuildFragment | undefined> {
    const easJsonReader = new EasJsonReader(projectDir);
    const buildProfile = await easJsonReader.readBuildProfileAsync(platform, flags.profile);
    const buildCtx = await createBuildContextAsync({
      buildProfileName: flags.profile,
      clearCache: flags.clearCache,
      buildProfile,
      local: flags.local,
      nonInteractive: flags.nonInteractive,
      platform,
      projectDir,
      skipProjectConfiguration: flags.skipProjectConfiguration,
    });

    if (moreBuilds) {
      Log.newLine();
      const appPlatform = toAppPlatform(platform);
      Log.log(
        `${appPlatformEmojis[appPlatform]} ${chalk.bold(
          `${appPlatformDisplayNames[appPlatform]} build`
        )}`
      );
    }

    if (buildCtx.workflow === Workflow.MANAGED && !this.metroConfigValidated) {
      await validateMetroConfigForManagedWorkflowAsync(buildCtx);
      this.metroConfigValidated = true;
    }

    if (!buildCtx.local && !(await isEasEnabledForProjectAsync(buildCtx.projectId))) {
      error(EAS_UNAVAILABLE_MESSAGE, { exit: 1 });
    }

    return await this.startBuildAsync(buildCtx);
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

  private async prepareAndStartSubmissionAsync({
    projectDir,
    build,
    flags,
    moreBuilds,
  }: {
    projectDir: string;
    build: BuildFragment;
    flags: BuildFlags;
    moreBuilds: boolean;
  }): Promise<SubmissionFragment> {
    const easJsonReader = new EasJsonReader(projectDir);
    const platform = toPlatform(build.platform);
    const submitProfile = await easJsonReader.readSubmitProfileAsync(platform, flags.submitProfile);
    const submissionCtx = createSubmissionContext({
      platform,
      projectDir,
      projectId: build.project.id,
      profile: submitProfile,
      archiveFlags: { id: build.id },
      nonInteractive: flags.nonInteractive,
    });

    if (moreBuilds) {
      Log.newLine();
      Log.log(
        `${appPlatformEmojis[build.platform]} ${chalk.bold(
          `${appPlatformDisplayNames[build.platform]} submission`
        )}`
      );
    }

    return await submitAsync(submissionCtx);
  }

  private exitWithNonZeroCodeIfSomeBuildsFailed(maybeBuilds: (BuildFragment | null)[]): void {
    const failedBuilds = (maybeBuilds.filter(i => i) as BuildFragment[]).filter(
      i => i.status === BuildStatus.Errored
    );
    if (failedBuilds.length > 0) {
      process.exit(1);
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
