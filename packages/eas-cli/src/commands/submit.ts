import { getConfig } from '@expo/config';
import { Platform } from '@expo/eas-build-job';
import { EasJsonReader } from '@expo/eas-json';
import { flags } from '@oclif/command';
import { error } from '@oclif/errors';
import chalk from 'chalk';

import EasCommand from '../commandUtils/EasCommand';
import { AppPlatform, SubmissionFragment, SubmissionStatus } from '../graphql/generated';
import { toAppPlatform } from '../graphql/types/AppPlatform';
import Log, { learnMore } from '../log';
import {
  RequestedPlatform,
  appPlatformDisplayNames,
  appPlatformEmojis,
  selectRequestedPlatformAsync,
  toPlatforms,
} from '../platform';
import { isEasEnabledForProjectAsync, warnEasUnavailable } from '../project/isEasEnabledForProject';
import { findProjectRootAsync, getProjectIdAsync } from '../project/projectUtils';
import AndroidSubmitCommand from '../submissions/android/AndroidSubmitCommand';
import {
  SubmissionContext,
  SubmitArchiveFlags,
  createSubmissionContext,
} from '../submissions/context';
import IosSubmitCommand from '../submissions/ios/IosSubmitCommand';
import { displayLogsAsync } from '../submissions/utils/logs';
import { printSubmissionDetailsUrls } from '../submissions/utils/urls';
import { waitForSubmissionsEndAsync } from '../submissions/utils/wait';

interface RawFlags {
  platform?: string;
  profile?: string;
  latest?: boolean;
  id?: string;
  path?: string;
  url?: string;
  verbose: boolean;
  wait: boolean;
}

interface Flags {
  requestedPlatform: RequestedPlatform;
  profile?: string;
  archiveFlags: SubmitArchiveFlags;
  verbose: boolean;
  wait: boolean;
}

export default class Submit extends EasCommand {
  static description = `submit build archive to app store
See how to configure submits with eas.json: ${learnMore('https://docs.expo.dev/submit/eas-json/', {
    learnMoreMessage: '',
  })}`;
  static aliases = ['build:submit'];

  static flags = {
    platform: flags.enum({
      char: 'p',
      options: ['android', 'ios', 'all'],
    }),
    profile: flags.string({
      description:
        'Name of the submit profile from eas.json. Defaults to "release" if defined in eas.json.',
    }),
    latest: flags.boolean({
      description: 'Submit the latest build for specified platform',
      exclusive: ['id', 'path', 'url'],
    }),
    id: flags.string({
      description: 'ID of the build to submit',
      exclusive: ['latest, path, url'],
    }),
    path: flags.string({
      description: 'Path to the .apk/.aab/.ipa file',
      exclusive: ['latest', 'id', 'url'],
    }),
    url: flags.string({
      description: 'App archive url',
      exclusive: ['latest', 'id', 'path'],
    }),
    verbose: flags.boolean({
      description: 'Always print logs from Submission Service',
      default: false,
    }),
    wait: flags.boolean({
      description: 'Wait for submission to complete',
      default: true,
      allowNo: true,
    }),
  };

  async run(): Promise<void> {
    const { flags: rawFlags } = this.parse(Submit);
    const flags = await this.sanitizeFlagsAsync(rawFlags);

    const projectDir = (await findProjectRootAsync()) ?? process.cwd();
    const { exp } = getConfig(projectDir, { skipSDKVersionRequirement: true });
    const projectId = await getProjectIdAsync(exp);

    if (!(await isEasEnabledForProjectAsync(projectId))) {
      warnEasUnavailable();
      process.exitCode = 1;
      return;
    }

    const easJsonReader = new EasJsonReader(projectDir);
    const platforms = toPlatforms(flags.requestedPlatform);
    const submissions: SubmissionFragment[] = [];
    for (const platform of platforms) {
      const profile = await easJsonReader.readSubmitProfileAsync(platform, flags.profile);
      const ctx = createSubmissionContext({
        platform,
        projectDir,
        projectId,
        profile,
        archiveFlags: flags.archiveFlags,
      });

      if (platforms.length > 1) {
        Log.newLine();
        const appPlatform = toAppPlatform(platform);
        Log.log(
          `${appPlatformEmojis[appPlatform]} ${chalk.bold(
            `${appPlatformDisplayNames[appPlatform]} submission`
          )}`
        );
      }

      const submission = await this.submitAsync(ctx);
      submissions.push(submission);
    }

    Log.newLine();
    printSubmissionDetailsUrls(submissions);

    if (flags.wait) {
      this.waitToCompleteAsync(submissions, flags);
    }
  }

  private async sanitizeFlagsAsync(flags: RawFlags): Promise<Flags> {
    const { platform, verbose, wait, profile, ...archiveFlags } = flags;

    const requestedPlatform = await selectRequestedPlatformAsync(flags.platform);

    if (requestedPlatform === RequestedPlatform.All) {
      if (archiveFlags.id || archiveFlags.path || archiveFlags.url) {
        error(
          '--id, --path, and --url params are only supported when performing a single-platform submit',
          { exit: 1 }
        );
      }
    }

    return {
      archiveFlags,
      requestedPlatform,
      verbose,
      wait,
      profile,
    };
  }

  private async submitAsync<T extends Platform>(
    ctx: SubmissionContext<T>
  ): Promise<SubmissionFragment> {
    const command =
      ctx.platform === Platform.ANDROID
        ? new AndroidSubmitCommand(ctx as SubmissionContext<Platform.ANDROID>)
        : new IosSubmitCommand(ctx as SubmissionContext<Platform.IOS>);
    return command.runAsync();
  }

  private async waitToCompleteAsync(
    submissions: SubmissionFragment[],
    flags: Flags
  ): Promise<void> {
    Log.newLine();
    const completedSubmissions = await waitForSubmissionsEndAsync(submissions);
    if (completedSubmissions.length > 1) {
      Log.newLine();
    }
    for (const submission of completedSubmissions) {
      if (completedSubmissions.length > 1) {
        Log.log(
          `${appPlatformEmojis[submission.platform]} ${chalk.bold(
            `${appPlatformDisplayNames[submission.platform]} submission`
          )}`
        );
      }
      this.printInstructionsForIosSubmission(submission);
      await displayLogsAsync(submission, { verbose: flags.verbose });
      if (completedSubmissions.length > 1) {
        Log.newLine();
      }
    }
    this.exitWithNonZeroCodeIfSomeSubmissionsDidntFinish(completedSubmissions);
  }

  private printInstructionsForIosSubmission(submission: SubmissionFragment): void {
    if (
      submission.platform === AppPlatform.Ios &&
      submission.status === SubmissionStatus.Finished
    ) {
      const logMsg = [
        chalk.bold('Your binary has been successfully uploaded to App Store Connect!'),
        '- It is now being processed by Apple - you will receive an e-mail when the processing finishes.',
        '- It usually takes about 5-10 minutes depending on how busy Apple servers are.',
        // ascAppIdentifier should be always available for ios submissions but check it anyway
        submission.iosConfig?.ascAppIdentifier &&
          `- When it’s done, you can see your build here: ${learnMore(
            `https://appstoreconnect.apple.com/apps/${submission.iosConfig?.ascAppIdentifier}/appstore/ios`,
            { learnMoreMessage: '' }
          )}`,
      ].join('\n');
      Log.addNewLineIfNone();
      Log.log(logMsg);
    }
  }

  private exitWithNonZeroCodeIfSomeSubmissionsDidntFinish(submissions: SubmissionFragment[]): void {
    const nonFinishedSubmissions = submissions.filter(
      ({ status }) => status !== SubmissionStatus.Finished
    );
    if (nonFinishedSubmissions.length > 0) {
      process.exit(1);
    }
  }
}
