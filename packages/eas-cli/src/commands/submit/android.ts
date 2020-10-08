import { Command, flags } from '@oclif/command';

import AndroidSubmitCommand from '../../submit/android/AndroidSubmitCommand';
import { AndroidSubmitCommandOptions } from '../../submit/android/types';

export default class SubmitAndroid extends Command {
  static description = 'Upload an Android binary to the Google Play Store';

  // static flags = {
  //   { name: 'latest', description: 'submit the latest build' },
  //   { name: 'id', description: 'id of the build to submit' },
  //   { name: 'path', description: 'path to the .apk/.aab file' },
  //   { name: 'url', description: 'app archive url' },
  //   { name: 'key', description: 'path to the JSON key used to authenticate with Google Play' },
  //   {
  //     name: 'android-package',
  //     description: 'Android package name (using expo.android.package from app.json by default)',
  //   },
  //   {
  //     name: 'track',
  //     description:
  //       'the track of the application to use, choose from: production, beta, alpha, internal, rollout',
  //     default: 'internal',
  //     options: ['production', 'beta', 'alpha', 'internal', 'rollout'],
  //   },
  //   {
  //     name: 'release-status',
  //     description:
  //       'release status (used when uploading new apks/aabs), choose from: completed, draft, halted, inProgress',
  //     default: 'completed',
  //     options: ['completed', 'draft', 'halted', 'inProgress'],
  //   },
  // };

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
      flags: { latest, id, path, url, key, track, verbose, ...flags },
    } = this.parse(SubmitAndroid);

    const projectDir = 'TODO';

    const options: AndroidSubmitCommandOptions = {
      latest,
      id,
      path,
      url,
      key,
      track,
      verbose,
      androidPackage: flags['android-package'],
      releaseStatus: flags['release-status'],
    };

    const ctx = AndroidSubmitCommand.createContext(projectDir, options);
    //const command = new AndroidSubmitCommand(ctx);
    //await command.runAsync();
    console.log(ctx);

    throw new Error('Not implemented');
  }
}
