import { Command, flags } from '@oclif/command';

import { learnMore } from '../log';
import { isEasEnabledForProjectAsync, warnEasUnavailable } from '../project/isEasEnabledForProject';
import { findProjectRootAsync, getProjectIdAsync } from '../project/projectUtils';
import { promptAsync } from '../prompts';
import AndroidSubmitCommand from '../submissions/android/AndroidSubmitCommand';
import IosSubmitCommand from '../submissions/ios/IosSubmitCommand';
import {
  AndroidSubmitCommandFlags,
  IosSubmitCommandFlags,
  SubmissionPlatform,
} from '../submissions/types';
import { ensureLoggedInAsync } from '../user/actions';

const COMMON_FLAGS = '';
const ANDROID_FLAGS = 'Android specific options';
const IOS_FLAGS = 'iOS specific options';

export default class BuildSubmit extends Command {
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
      default: false,
      helpLabel: COMMON_FLAGS,
    }),

    /* Android specific flags */
    type: flags.enum<'apk' | 'aab'>({
      description: 'Android archive type',
      options: ['apk', 'aab'],
      helpLabel: ANDROID_FLAGS,
    }),

    key: flags.string({
      description: 'Path to the JSON key used to authenticate with Google Play',
      helpLabel: ANDROID_FLAGS,
    }),
    'android-package': flags.string({
      description: 'Android package name (default: expo.android.package from app config)',
      helpLabel: ANDROID_FLAGS,
    }),

    track: flags.enum({
      description: 'The track of the application to use',
      default: 'internal',
      options: ['production', 'beta', 'alpha', 'internal', 'rollout'],
      helpLabel: ANDROID_FLAGS,
    }),
    'release-status': flags.enum({
      description: 'Release status (used when uploading new APKs/AABs)',
      default: 'completed',
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
      description: 'Primary language (e.g. English, German, ...)',
      default: 'en-US',
      helpLabel: IOS_FLAGS,
    }),
    'company-name': flags.string({
      description:
        'The name of your company, needed only for the first upload of any app to App Store',
      helpLabel: IOS_FLAGS,
    }),
  };

  async run(): Promise<void> {
    const {
      flags: {
        // android
        'android-package': androidPackage,
        'release-status': releaseStatus,

        // ios
        'apple-id': appleId,
        'asc-app-id': ascAppId,
        'apple-team-id': appleTeamId,
        'app-name': appName,
        'bundle-identifier': bundleIdentifier,
        'company-name': companyName,

        // common
        platform: platformFromParams,
        ...flags
      },
    } = this.parse(BuildSubmit);

    await ensureLoggedInAsync();

    const platform = platformFromParams ?? (await promptForPlatformAsync());

    const projectDir = (await findProjectRootAsync()) ?? process.cwd();
    const projectId = await getProjectIdAsync(projectDir);

    if (!(await isEasEnabledForProjectAsync(projectId))) {
      warnEasUnavailable();
      process.exitCode = 1;
      return;
    }

    // TODO: Make this work outside project dir
    if (!projectDir) {
      throw new Error("Please run this command inside your project's directory");
    }

    if (platform === SubmissionPlatform.Android) {
      const options: AndroidSubmitCommandFlags = {
        androidPackage,
        releaseStatus,
        ...flags,
      };

      const ctx = AndroidSubmitCommand.createContext(projectDir, projectId, options);
      const command = new AndroidSubmitCommand(ctx);
      await command.runAsync();
    } else if (platform === SubmissionPlatform.iOS) {
      const options: IosSubmitCommandFlags = {
        appleId,
        ascAppId,
        appleTeamId,
        appName,
        bundleIdentifier,
        companyName,
        ...flags,
      };

      const ctx = IosSubmitCommand.createContext(projectDir, projectId, options);
      const command = new IosSubmitCommand(ctx);
      await command.runAsync();
    } else {
      throw new Error(`Unsupported platform: ${platform}!`);
    }
  }
}

async function promptForPlatformAsync(): Promise<SubmissionPlatform> {
  const { platform } = await promptAsync({
    type: 'select',
    message: 'Submit to platform',
    name: 'platform',
    choices: [
      {
        title: 'iOS',
        value: SubmissionPlatform.iOS,
      },
      {
        title: 'Android',
        value: SubmissionPlatform.Android,
      },
    ],
  });
  return platform;
}
