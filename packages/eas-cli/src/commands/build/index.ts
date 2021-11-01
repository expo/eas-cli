import { Platform, Workflow } from '@expo/eas-build-job';
import { BuildProfile, EasJsonReader } from '@expo/eas-json';
import { flags } from '@oclif/command';
import { error } from '@oclif/errors';
import chalk from 'chalk';
import figures from 'figures';
import fs from 'fs-extra';
import nullthrows from 'nullthrows';

import { prepareAndroidBuildAsync } from '../../build/android/build';
import { BuildRequestSender, waitForBuildEndAsync } from '../../build/build';
import { ensureProjectConfiguredAsync } from '../../build/configure';
import { BuildContext, createBuildContextAsync } from '../../build/context';
import { prepareIosBuildAsync } from '../../build/ios/build';
import { ensureExpoDevClientInstalledForDevClientBuildsAsync } from '../../build/utils/devClient';
import { printBuildResults, printLogsUrls } from '../../build/utils/printBuildInfo';
import { ensureRepoIsCleanAsync } from '../../build/utils/repository';
import EasCommand from '../../commandUtils/EasCommand';
import { CredentialsContext } from '../../credentials/context';
import {
  AppPlatform,
  BuildFragment,
  BuildStatus,
  SubmissionFragment,
} from '../../graphql/generated';
import { toAppPlatform, toPlatform } from '../../graphql/types/AppPlatform';
import Log, { learnMore, link } from '../../log';
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
import { selectAsync } from '../../prompts';
import { createSubmissionContextAsync } from '../../submit/context';
import {
  submitAsync,
  waitToCompleteAsync as waitForSubmissionsToCompleteAsync,
} from '../../submit/submit';
import { printSubmissionDetailsUrls } from '../../submit/utils/urls';
import { easCliVersion } from '../../utils/easCli';
import { enableJsonOutput } from '../../utils/json';
import { ProfileData, getProfilesAsync } from '../../utils/profiles';
import { getVcsClient, setVcsClient } from '../../vcs';
import GitClient from '../../vcs/clients/git';

interface RawBuildFlags {
  platform?: string;
  'skip-credentials-check': boolean;
  'skip-project-configuration': boolean;
  profile?: string;
  'non-interactive': boolean;
  local: boolean;
  wait: boolean;
  'clear-cache': boolean;
  json: boolean;
  'auto-submit': boolean;
  'auto-submit-with-profile'?: string;
}

interface BuildFlags {
  requestedPlatform: RequestedPlatform;
  skipProjectConfiguration: boolean;
  profile: string | null;
  nonInteractive: boolean;
  local: boolean;
  wait: boolean;
  clearCache: boolean;
  json: boolean;
  autoSubmit: boolean;
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
      description:
        'Name of the build profile from eas.json. Defaults to "production" if defined in eas.json.',
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
    'auto-submit': flags.boolean({
      default: false,
      description:
        'Submit on build complete using the submit profile with the same name as the build profile',
      exclusive: ['auto-submit-with-profile'],
    }),
    'auto-submit-with-profile': flags.string({
      description: 'Submit on build complete using the submit profile with provided name',
      helpValue: 'PROFILE_NAME',
      exclusive: ['auto-submit'],
    }),
  };

  private metroConfigValidated = false;

  async runAsync(): Promise<void> {
    const { flags: rawFlags } = this.parse(Build);
    if (rawFlags.json) {
      enableJsonOutput();
    }
    const flags = await this.sanitizeFlagsAsync(rawFlags);
    const { requestedPlatform } = flags;

    const projectDir = await findProjectRootAsync();
    await handleDeprecatedEasJsonAsync(projectDir, flags.nonInteractive);

    await getVcsClient().ensureRepoExistsAsync();
    await ensureRepoIsCleanAsync(flags.nonInteractive);

    await ensureProjectConfiguredAsync(projectDir, requestedPlatform);

    const platforms = toPlatforms(requestedPlatform);
    const easJsonReader = new EasJsonReader(projectDir);
    const buildProfiles = await getProfilesAsync({
      platforms,
      profileName: flags.profile,
      async readProfileAsync(platform, profileName) {
        return await easJsonReader.readBuildProfileAsync(platform, profileName);
      },
    });

    await ensureExpoDevClientInstalledForDevClientBuildsAsync({
      projectDir,
      nonInteractive: flags.nonInteractive,
      buildProfiles,
    });

    const startedBuilds: {
      build: BuildFragment;
      buildProfile: ProfileData<BuildProfile>;
    }[] = [];
    const buildCtxByPlatform: { [p in AppPlatform]?: BuildContext<Platform> } = {};

    for (const buildProfile of buildProfiles) {
      const { build: maybeBuild, buildCtx } = await this.prepareAndStartBuildAsync({
        projectDir,
        flags,
        moreBuilds: platforms.length > 1,
        buildProfile,
      });
      if (maybeBuild) {
        startedBuilds.push({ build: maybeBuild, buildProfile });
      }
      buildCtxByPlatform[toAppPlatform(buildProfile.platform)] = buildCtx;
    }

    if (flags.local) {
      return;
    }

    Log.newLine();
    printLogsUrls(startedBuilds.map(startedBuild => startedBuild.build));
    Log.newLine();

    const submissions: SubmissionFragment[] = [];
    if (flags.autoSubmit) {
      for (const startedBuild of startedBuilds) {
        const submission = await this.prepareAndStartSubmissionAsync({
          build: startedBuild.build,
          credentialsCtx: nullthrows(
            buildCtxByPlatform[startedBuild.build.platform]?.credentialsCtx
          ),
          flags,
          moreBuilds: startedBuilds.length > 1,
          projectDir,
          buildProfile: startedBuild.buildProfile,
        });
        submissions.push(submission);
      }

      Log.newLine();
      printSubmissionDetailsUrls(submissions);
      Log.newLine();
    }

    if (!flags.wait) {
      return;
    }

    const builds = await waitForBuildEndAsync(startedBuilds.map(({ build }) => build.id));
    printBuildResults(builds, flags.json);

    const haveAllBuildsFailedOrCanceled = builds.every(
      build => build?.status && [BuildStatus.Errored, BuildStatus.Canceled].includes(build?.status)
    );
    if (haveAllBuildsFailedOrCanceled || !flags.autoSubmit) {
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
      if (flags['auto-submit'] || flags['auto-submit-with-profile'] !== undefined) {
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
      profile: profile ?? null,
      nonInteractive,
      local: flags['local'],
      wait: flags['wait'],
      clearCache: flags['clear-cache'],
      json: flags['json'],
      autoSubmit: flags['auto-submit'],
      submitProfile: flags['auto-submit-with-profile'] ?? profile,
    };
  }

  private async prepareAndStartBuildAsync({
    projectDir,
    flags,
    moreBuilds,
    buildProfile,
  }: {
    projectDir: string;
    flags: BuildFlags;
    moreBuilds: boolean;
    buildProfile: ProfileData<BuildProfile>;
  }): Promise<{ build: BuildFragment | undefined; buildCtx: BuildContext<Platform> }> {
    const buildCtx = await createBuildContextAsync({
      buildProfileName: buildProfile.profileName,
      clearCache: flags.clearCache,
      buildProfile: buildProfile.profile,
      local: flags.local,
      nonInteractive: flags.nonInteractive,
      platform: buildProfile.platform,
      projectDir,
      skipProjectConfiguration: flags.skipProjectConfiguration,
    });

    if (moreBuilds) {
      Log.newLine();
      const appPlatform = toAppPlatform(buildProfile.platform);
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

    const build = await this.startBuildAsync(buildCtx);
    return {
      build,
      buildCtx,
    };
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
    build,
    credentialsCtx,
    flags,
    moreBuilds,
    projectDir,
    buildProfile,
  }: {
    build: BuildFragment;
    credentialsCtx: CredentialsContext;
    flags: BuildFlags;
    moreBuilds: boolean;
    projectDir: string;
    buildProfile: ProfileData<BuildProfile>;
  }): Promise<SubmissionFragment> {
    const easJsonReader = new EasJsonReader(projectDir);
    const platform = toPlatform(build.platform);
    const submitProfile = await easJsonReader.readSubmitProfileAsync(platform, flags.submitProfile);
    const submissionCtx = await createSubmissionContextAsync({
      platform,
      projectDir,
      projectId: build.project.id,
      profile: submitProfile,
      archiveFlags: { id: build.id },
      nonInteractive: flags.nonInteractive,
      env: buildProfile.profile.env,
      credentialsCtx,
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
  if (!(await fs.pathExists(EasJsonReader.formatEasJsonPath(projectDir)))) {
    return;
  }
  const easJsonReader = new EasJsonReader(projectDir);
  const rawEasJson = await easJsonReader.readRawAsync();
  if (rawEasJson?.cli) {
    return;
  }

  if (nonInteractive) {
    Log.warn(
      `${
        figures.warning
      } Action required: the default behavior of EAS CLI has changed and your eas.json must be updated to remove ambiguity around which Git integration workflow to use. Refer to ${link(
        'https://expo.fyi/eas-vcs-workflow'
      )} for more information.`
    );
    Log.warn(
      'This warning will become an error in an upcoming EAS CLI release. For now, we will proceed with the old default behavior to avoid disruption of your builds.'
    );
    setVcsClient(new GitClient());
    return;
  }
  Log.log(
    `${chalk.bold(
      'eas-cli@>=0.34.0 no longer requires that you commit changes to Git before starting a build.'
    )} ${learnMore('https://expo.fyi/eas-vcs-workflow')}`
  );
  Log.log(
    `If you want to continue using the Git integration, you can opt in with ${chalk.bold(
      'cli.requireCommit'
    )} in ${chalk.bold('eas.json')} or with the following prompt.`
  );
  Log.newLine();

  const mode = await selectAsync('Select your preferred Git integration', [
    { title: 'Require changes to be committed in Git (old default)', value: 'requireCommit' },
    { title: 'Allow builds with dirty Git working tree (new default)', value: 'noCommit' },
  ]);

  rawEasJson.cli =
    mode === 'requireCommit'
      ? { version: `>= ${easCliVersion}`, requireCommit: true }
      : { version: `>= ${easCliVersion}` };
  await fs.writeJSON(EasJsonReader.formatEasJsonPath(projectDir), rawEasJson, { spaces: 2 });
  if (mode === 'requireCommit') {
    setVcsClient(new GitClient());
  }
}
