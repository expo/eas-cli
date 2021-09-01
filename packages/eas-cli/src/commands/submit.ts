import { getConfig } from '@expo/config';
import { Platform } from '@expo/eas-build-job';
import { EasJsonReader, IosSubmitProfile } from '@expo/eas-json';
import { flags } from '@oclif/command';
import { exit } from '@oclif/errors';
import chalk from 'chalk';

import EasCommand from '../commandUtils/EasCommand';
import { AppPlatform, SubmissionFragment, SubmissionStatus } from '../graphql/generated';
import Log, { learnMore } from '../log';
import { appPlatformDisplayNames, appPlatformEmojis } from '../platform';
import { isEasEnabledForProjectAsync, warnEasUnavailable } from '../project/isEasEnabledForProject';
import { findProjectRootAsync, getProjectIdAsync } from '../project/projectUtils';
import { promptAsync } from '../prompts';
import AndroidSubmitCommand from '../submissions/android/AndroidSubmitCommand';
import IosSubmitCommand from '../submissions/ios/IosSubmitCommand';
import { SubmitArchiveFlags } from '../submissions/types';
import { displayLogsAsync } from '../submissions/utils/logs';
import { printSubmissionDetailsUrls } from '../submissions/utils/urls';
import { waitForSubmissionsEndAsync } from '../submissions/utils/wait';

interface Flags {
  verbose: boolean;
  wait: boolean;
  platform?: Platform;
  profile: string;
  archiveFlags: SubmitArchiveFlags;
}

export default class BuildSubmit extends EasCommand {
  static description = 'Submit build archive to app store';
  static aliases = ['build:submit'];

  static flags = {
    platform: flags.enum({
      char: 'p',
      options: ['android', 'ios'],
    }),
    profile: flags.string({
      default: 'release',
      description: 'Name of the submit profile from eas.json',
    }),
    latest: flags.boolean({
      description: 'Submit the latest build for specified platform',
      exclusive: ['id', 'path', 'url'],
      default: false,
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
    const flags = this.parseFlags();
    const platform =
      (flags.platform?.toUpperCase() as AppPlatform | undefined) ??
      (await this.promptForPlatformAsync());

    const projectDir = (await findProjectRootAsync()) ?? process.cwd();
    const { exp } = getConfig(projectDir, { skipSDKVersionRequirement: true });
    const projectId = await getProjectIdAsync(exp);

    if (!(await isEasEnabledForProjectAsync(projectId))) {
      warnEasUnavailable();
      process.exitCode = 1;
      return;
    }

    const easJsonReader = new EasJsonReader(projectDir);

    const submissions: SubmissionFragment[] = [];
    let iosSubmitProfile: IosSubmitProfile | null = null;
    if (platform === AppPlatform.Android) {
      const submitProfile = await easJsonReader.readSubmitProfileAsync(
        flags.profile,
        Platform.ANDROID
      );
      const ctx = AndroidSubmitCommand.createContext({
        projectDir,
        projectId,
        profile: submitProfile,
        archiveFlags: flags.archiveFlags,
      });
      const command = new AndroidSubmitCommand(ctx);
      submissions.push(await command.runAsync());
    } else {
      iosSubmitProfile = await easJsonReader.readSubmitProfileAsync(flags.profile, Platform.IOS);
      const ctx = IosSubmitCommand.createContext({
        projectDir,
        projectId,
        profile: iosSubmitProfile,
        archiveFlags: flags.archiveFlags,
      });
      const command = new IosSubmitCommand(ctx);
      submissions.push(await command.runAsync());
    }

    Log.newLine();
    printSubmissionDetailsUrls(submissions);

    if (flags.wait) {
      Log.newLine();
      const completedSubmissions = await waitForSubmissionsEndAsync(submissions);
      for (const submission of completedSubmissions) {
        if (completedSubmissions.length > 1) {
          Log.log(
            `${appPlatformEmojis[submission.platform]}${chalk.bold(
              `${appPlatformDisplayNames[submission.platform]} submission`
            )}`
          );
        }
        if (
          submission.platform === AppPlatform.Ios &&
          submission.status === SubmissionStatus.Finished
        ) {
          const logMsg = [
            chalk.bold('Your binary has been successfully uploaded to App Store Connect!'),
            '- It is now being processed by Apple - you will receive an e-mail when the processing finishes.',
            '- It usually takes about 5-10 minutes depending on how busy Apple servers are.',
            iosSubmitProfile?.ascAppId &&
              `- When it’s done, you can see your build here ${learnMore(
                `https://appstoreconnect.apple.com/apps/${iosSubmitProfile.ascAppId}/appstore/ios`,
                { learnMoreMessage: '' }
              )}`,
          ].join('\n');
          Log.addNewLineIfNone();
          Log.log(logMsg);
        }
        await displayLogsAsync(submission, { verbose: flags.verbose });
        if (completedSubmissions.length > 1) {
          Log.newLine();
        }
      }
      this.exitWithNonZeroCodeIfSomeSubmissionsDidntFinish(completedSubmissions);
    }
  }

  private parseFlags(): Flags {
    const {
      flags: { platform, profile, verbose, wait, ...archiveFlags },
    } = this.parse(BuildSubmit);

    return {
      platform: platform as Platform,
      profile,
      verbose,
      wait,
      archiveFlags,
    };
  }

  private async promptForPlatformAsync(): Promise<AppPlatform> {
    const { platform } = await promptAsync({
      type: 'select',
      message: 'Submit to platform',
      name: 'platform',
      choices: [
        {
          title: 'iOS',
          value: AppPlatform.Ios,
        },
        {
          title: 'Android',
          value: AppPlatform.Android,
        },
      ],
    });
    return platform;
  }

  private exitWithNonZeroCodeIfSomeSubmissionsDidntFinish(submissions: SubmissionFragment[]): void {
    const nonFinishedSubmissions = submissions.filter(
      ({ status }) => status !== SubmissionStatus.Finished
    );
    if (nonFinishedSubmissions.length > 0) {
      exit(1);
    }
  }
}
