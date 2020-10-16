import { Command, flags } from '@oclif/command';
import { SubmissionPlatform, AndroidSubmitCommandFlags } from '../../submissions/types';

import AndroidSubmitCommand from '../../submissions/android/AndroidSubmitCommand';
import { findProjectRootAsync } from '../../project/projectUtils';
import { ensureLoggedInAsync } from '../../user/actions';

export default class BuildSubmit extends Command {
  static description = 'Submits build artifact to app store';

  static flags = {
    platform: flags.enum({
      char: 'p',
      description: 'For which platform you want to submit a build',
      options: ['android', 'ios'],
      required: true,
    }),

    /* Common flags for both platforms */
    latest: flags.boolean({
      description: 'Submit the latest build',
      exclusive: ['id', 'path', 'url'],
      default: false,
    }),
    id: flags.string({
      description: 'ID of the build to submit',
      exclusive: ['latest, path, url'],
    }),
    path: flags.string({
      description: 'Path to the .apk/.aab file',
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

    /* Android specific flags */
    type: flags.enum<'apk' | 'aab'>({
      description: 'Android archive type',
      options: ['apk', 'aab'],
    }),

    key: flags.string({
      description: 'Path to the JSON key used to authenticate with Google Play',
    }),
    'android-package': flags.string({
      description: 'Android package name (using expo.android.package from app.json by default)',
    }),

    track: flags.enum({
      description:
        'The track of the application to use, choose from: production, beta, alpha, internal, rollout',
      default: 'internal',
      options: ['production', 'beta', 'alpha', 'internal', 'rollout'],
    }),
    'release-status': flags.enum({
      description:
        'Release status (used when uploading new apks/aabs), choose from: completed, draft, halted, inProgress',
      default: 'completed',
      options: ['completed', 'draft', 'halted', 'inProgress'],
    }),
  };

  async run() {
    const {
      flags: {
        'android-package': androidPackage,
        'release-status': releaseStatus,
        platform,
        ...flags
      },
    } = this.parse(BuildSubmit);

    // TODO: Remove this when iOS is supported
    if (platform !== SubmissionPlatform.Android) {
      throw new Error(`Platform ${platform} is not supported yet!`);
    }

    await ensureLoggedInAsync();
    const projectDir = await findProjectRootAsync(process.cwd());

    // TODO: Make this work outside project dir
    if (!projectDir) {
      throw new Error("Please run this command inside your project's directory");
    }

    const options: AndroidSubmitCommandFlags = {
      androidPackage,
      releaseStatus,
      ...flags,
    };

    const ctx = AndroidSubmitCommand.createContext(projectDir, options);
    const command = new AndroidSubmitCommand(ctx);
    await command.runAsync();
  }
}
