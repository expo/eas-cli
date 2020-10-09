import { Command, flags } from '@oclif/command';

import AndroidSubmitCommand from '../../submit/android/AndroidSubmitCommand';
import { AndroidSubmitCommandFlags } from '../../submit/android/types';

export default class SubmitAndroid extends Command {
  static description = 'Upload an Android binary to the Google Play Store';

  static flags = {
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

    verbose: flags.boolean({
      description: 'Always print logs from Submission Service',
      default: false,
    }),
  };

  async run() {
    const {
      flags: { 'android-package': androidPackage, 'release-status': releaseStatus, ...flags },
    } = this.parse(SubmitAndroid);

    const projectDir = 'TODO';

    const options: AndroidSubmitCommandFlags = {
      androidPackage,
      releaseStatus,
      ...flags,
    };

    const ctx = AndroidSubmitCommand.createContext(projectDir, options);
    //const command = new AndroidSubmitCommand(ctx);
    //await command.runAsync();
    console.log(ctx);

    throw new Error('Not implemented');
  }
}
