import { getConfig } from '@expo/config';
import { Platform } from '@expo/eas-build-job';
import { EasJsonReader } from '@expo/eas-json';
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
import { AndroidSubmitCommandFlags, IosSubmitCommandFlags } from '../submissions/types';
import { displayLogsAsync } from '../submissions/utils/logs';
import { printSubmissionDetailsUrls } from '../submissions/utils/urls';
import { waitForSubmissionsEndAsync } from '../submissions/utils/wait';

const COMMON_FLAGS = '';
const ANDROID_FLAGS = 'Android specific options';
const IOS_FLAGS = 'iOS specific options';

interface Flags {
  verbose: boolean;
  wait: boolean;
  platform?: Platform;
  profile?: string;
  iosOptions: Partial<IosSubmitCommandFlags>;
  androidOptions: Partial<AndroidSubmitCommandFlags>;
}

export default class BuildSubmit extends EasCommand {
  static description = 'Submits build artifact to app store';
  static usage = 'submit --platform=(android|ios)';
  static aliases = ['build:submit'];

  static examples = [
    `$ eas submit --platform=ios
    - Fully interactive iOS submission\n`,
    `$ eas submit --platform=android
    - Fully interactive Android submission\n`,
    `$ eas submit -p android --latest --key=/path/to/google-services.json
    - Minimal non-interactive Android submission, however it can ask you for other params if not specified\n`,
    `$ EXPO_APPLE_APP_SPECIFIC_PASSWORD=xxx eas submit -p ios --latest --apple-id=user@example.com --asc-app-id=1234567890,
    - Minimal non-interactive iOS submission, assuming you already have an app in App Store Connect
      and provide its App ID`,
  ];

  static flags = {
    platform: flags.enum({
      char: 'p',
      description: 'For which platform you want to submit a build',
      options: ['android', 'ios'],
      helpLabel: COMMON_FLAGS,
    }),

    /* Common flags for both platforms */
    profile: flags.string({
      description: 'Name of the submit profile from eas.json',
    }),
    latest: flags.boolean({
      description: 'Submit the latest build for specified platform',
      exclusive: ['id', 'path', 'url'],
      default: false,
      helpLabel: COMMON_FLAGS,
    }),
    id: flags.string({
      description: 'ID of the build to submit',
      exclusive: ['latest, path, url'],
      helpLabel: COMMON_FLAGS,
    }),
    path: flags.string({
      description: 'Path to the .apk/.aab file',
      exclusive: ['latest', 'id', 'url'],
      helpLabel: COMMON_FLAGS,
    }),
    url: flags.string({
      description: 'App archive url',
      exclusive: ['latest', 'id', 'path'],
      helpLabel: COMMON_FLAGS,
    }),

    verbose: flags.boolean({
      description: 'Always print logs from Submission Service',
      helpLabel: COMMON_FLAGS,
    }),

    /* Android specific flags */
    type: flags.enum<'apk' | 'aab'>({
      description: 'Android archive type',
      options: ['apk', 'aab'],
      helpLabel: ANDROID_FLAGS,
    }),

    key: flags.string({
      description:
        'Path to the JSON file with service account key used to authenticate with Google Play',
      helpLabel: ANDROID_FLAGS,
    }),
    'android-package': flags.string({
      description: 'Android package name (default: expo.android.package from app config)',
      helpLabel: ANDROID_FLAGS,
    }),

    track: flags.enum({
      description: '[default: internal] The track of the application to use',
      options: ['production', 'beta', 'alpha', 'internal', 'rollout'],
      helpLabel: ANDROID_FLAGS,
    }),
    'changes-not-sent-for-review': flags.boolean({
      description:
        '[default: false] Indicates that the changes sent with this submission will not be reviewed until they are explicitly sent for review from the Google Play Console UI',
      helpLabel: ANDROID_FLAGS,
    }),
    'release-status': flags.enum({
      description: '[default: completed] Release status (used when uploading new APKs/AABs)',
      options: ['completed', 'draft', 'halted', 'inProgress'],
      helpLabel: ANDROID_FLAGS,
    }),

    /* iOS specific flags */
    'apple-id': flags.string({
      description: 'Your Apple ID username (you can also set EXPO_APPLE_ID env variable)',
      helpLabel: IOS_FLAGS,
    }),
    'asc-app-id': flags.string({
      description: `App Store Connect unique application Apple ID number. Providing this param results in skipping app creation step. ${learnMore(
        'https://expo.fyi/asc-app-id'
      )}`,
      helpLabel: IOS_FLAGS,
    }),
    'apple-team-id': flags.string({
      description: 'Your Apple Developer Team ID',
      helpLabel: IOS_FLAGS,
    }),
    'app-name': flags.string({
      description:
        'The name of your app as it will appear on the App Store (default: expo.name from app config)',
      helpLabel: IOS_FLAGS,
    }),
    'bundle-identifier': flags.string({
      description:
        'Your iOS Bundle Identifier (default: expo.ios.bundleIdentifier from app config)',
      helpLabel: IOS_FLAGS,
    }),
    sku: flags.string({
      description:
        'An unique ID for your app that is not visible on the App Store, will be generated unless provided',
      helpLabel: IOS_FLAGS,
    }),
    language: flags.string({
      description: '[default: en-US] Primary language (e.g. English, German, ...)',
      helpLabel: IOS_FLAGS,
    }),
    'company-name': flags.string({
      description:
        'The name of your company, needed only for the first upload of any app to App Store',
      helpLabel: IOS_FLAGS,
    }),
    wait: flags.boolean({
      default: true,
      allowNo: true,
      description: 'Wait for submission to complete',
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
    if (platform === AppPlatform.Android) {
      const submitProfile = flags.profile
        ? await easJsonReader.readSubmitProfileAsync(flags.profile, Platform.ANDROID)
        : {};
      const commandFlags: AndroidSubmitCommandFlags = {
        releaseStatus: 'completed',
        track: 'internal',
        changesNotSentForReview: false,
        ...submitProfile,
        ...flags.androidOptions,
      };
      const ctx = AndroidSubmitCommand.createContext({
        projectDir,
        projectId,
        commandFlags,
      });
      const command = new AndroidSubmitCommand(ctx);
      submissions.push(await command.runAsync());
    } else {
      const submitProfile = flags.profile
        ? await easJsonReader.readSubmitProfileAsync(flags.profile, Platform.IOS)
        : {};
      const commandFlags: IosSubmitCommandFlags = {
        language: 'en-US',
        ...submitProfile,
        ...flags.iosOptions,
      };
      const ctx = IosSubmitCommand.createContext({
        projectDir,
        projectId,
        commandFlags,
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
          Log.addNewLineIfNone();
          Log.log(
            chalk.bold('Your binary has been successfully uploaded to App Store Connect!\n') +
              '- It is now being processed by Apple - you will receive an e-mail when the processing finishes.\n' +
              '- It usually takes about 5-10 minutes depending on how busy Apple servers are.\n' +
              '- When it’s done, you can see your build here' +
              learnMore(
                `https://appstoreconnect.apple.com/apps/${flags.iosOptions.ascAppId}/appstore/ios`,
                {
                  learnMoreMessage: '',
                }
              )
          );
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
      flags: {
        platform,
        profile,
        verbose,
        wait,

        // android
        'android-package': androidPackage,
        'release-status': releaseStatus,
        'changes-not-sent-for-review': changesNotSentForReview,
        track,
        type,
        key: serviceAccountKeyPath,

        // ios
        'apple-id': appleId,
        'asc-app-id': ascAppId,
        'apple-team-id': appleTeamId,
        'app-name': appName,
        'bundle-identifier': bundleIdentifier,
        'company-name': companyName,

        // common
        ...flags
      },
    } = this.parse(BuildSubmit);
    return {
      platform: platform as Platform,
      profile,
      androidOptions: {
        ...(androidPackage && { androidPackage }),
        ...(releaseStatus && { releaseStatus }),
        ...(track && { track }),
        ...(changesNotSentForReview && { changesNotSentForReview }),
        ...(serviceAccountKeyPath && { serviceAccountKeyPath }),
        ...flags,
      },
      iosOptions: {
        ...(appleId && { appleId }),
        ...(ascAppId && { ascAppId }),
        ...(appleTeamId && { appleTeamId }),
        ...(appName && { appName }),
        ...(bundleIdentifier && { bundleIdentifier }),
        ...(companyName && { companyName }),
        ...flags,
      },
      verbose,
      wait,
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
