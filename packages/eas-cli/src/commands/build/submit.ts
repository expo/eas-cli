import { Command, flags } from '@oclif/command';

import { findProjectRootAsync } from '../../project/projectUtils';
import AndroidSubmitCommand from '../../submissions/android/AndroidSubmitCommand';
import IosSubmitCommand from '../../submissions/ios/IosSubmitCommand';
import {
  AndroidSubmitCommandFlags,
  IosSubmitCommandFlags,
  SubmissionPlatform,
} from '../../submissions/types';
import { ensureLoggedInAsync } from '../../user/actions';

const COMMON_FLAGS = '';
const ANDROID_FLAGS = 'Android specific options';
const IOS_FLAGS = 'iOS specific options';

export default class BuildSubmit extends Command {
  static description = 'Submits build artifact to app store';

  static flags = {
    platform: flags.enum({
      char: 'p',
      description: 'For which platform you want to submit a build',
      options: ['android', 'ios'],
      required: true,
      helpLabel: COMMON_FLAGS,
    }),

    /* Common flags for both platforms */
    latest: flags.boolean({
      description: '23Submit the latest build',
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
      description: 'Android package name (using expo.android.package from app.json by default)',
      helpLabel: ANDROID_FLAGS,
    }),

    track: flags.enum({
      description:
        'The track of the application to use, choose from: production, beta, alpha, internal, rollout',
      default: 'internal',
      options: ['production', 'beta', 'alpha', 'internal', 'rollout'],
      helpLabel: ANDROID_FLAGS,
    }),
    'release-status': flags.enum({
      description:
        'Release status (used when uploading new apks/aabs), choose from: completed, draft, halted, inProgress',
      default: 'completed',
      options: ['completed', 'draft', 'halted', 'inProgress'],
      helpLabel: ANDROID_FLAGS,
    }),

    /* iOS specific flags */
    'apple-id': flags.string({
      description: 'Your Apple ID username (you can also set EXPO_APPLE_ID env variable)',
      helpLabel: IOS_FLAGS,
    }),
    'apple-app-specific-password': flags.string({
      description:
        'Your Apple ID app-specific password. You can also set EXPO_APPLE_APP_SPECIFIC_PASSWORD env variable.',
      helpLabel: IOS_FLAGS,
    }),
    'app-apple-id': flags.string({
      description: 'App Store Connect unique application Apple ID number.',
      helpLabel: IOS_FLAGS,
    }),
  };

  async run() {
    const {
      flags: {
        // android
        'android-package': androidPackage,
        'release-status': releaseStatus,

        // ios
        'apple-id': appleId,
        'apple-app-specific-password': appleAppSpecificPassword,
        'app-apple-id': appAppleId,

        // common
        platform,
        ...flags
      },
    } = this.parse(BuildSubmit);

    await ensureLoggedInAsync();
    const projectDir = await findProjectRootAsync(process.cwd());

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

      const ctx = AndroidSubmitCommand.createContext(projectDir, options);
      const command = new AndroidSubmitCommand(ctx);
      await command.runAsync();
    } else if (platform === SubmissionPlatform.iOS) {
      const options: IosSubmitCommandFlags = {
        appleId,
        appleAppSpecificPassword,
        appAppleId,
        ...flags,
      };

      const ctx = IosSubmitCommand.createContext(projectDir, options);
      const command = new IosSubmitCommand(ctx);
      await command.runAsync();
    } else {
      throw new Error(`Unsupported platform: ${platform}!`);
    }
  }
}
