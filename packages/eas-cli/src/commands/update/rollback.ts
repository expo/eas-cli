import { Flags } from '@oclif/core';

import UpdateRepublish from './republish';
import UpdateRollBackToEmbedded from './roll-back-to-embedded';
import EasCommand from '../../commandUtils/EasCommand';
import { EASNonInteractiveFlag } from '../../commandUtils/flags';
import Log from '../../log';
import { promptAsync } from '../../prompts';

export default class UpdateRollback extends EasCommand {
  static override description = 'roll back to an embedded update or an existing update';

  static override flags = {
    ...EASNonInteractiveFlag,
    'private-key-path': Flags.string({
      description: `File containing the PEM-encoded private key corresponding to the certificate in expo-updates' configuration. Defaults to a file named "private-key.pem" in the certificate's directory. Only relevant if you are using code signing: https://docs.expo.dev/eas-update/code-signing/`,
      required: false,
    }),
    'rollback-type': Flags.enum({
      description: 'Type of rollback to perform. In non-interactive mode, this flag is required.',
      options: ['published', 'embedded'],
      required: false,
    }),
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(UpdateRollback);
    const nonInteractive = flags['non-interactive'];
    let choice = flags['rollback-type'];
    if (nonInteractive && !choice) {
      throw new Error('Must supply rollback-type flag in non-interative mode');
    }
    if (!choice) {
      choice = (
        await promptAsync({
          type: 'select',
          message: 'Which type of update would you like to roll back to?',
          name: 'choice',
          choices: [
            { title: 'Published Update', value: 'published' },
            { title: 'Embedded Update', value: 'embedded' },
          ],
        })
      ).choice;
    }

    const privateKeyPathArg = flags['private-key-path']
      ? ['--private-key-path', flags['private-key-path']]
      : [];
    if (choice === 'published') {
      Log.debug(
        'Rolling back to a published update with private key path: ' +
          JSON.stringify(privateKeyPathArg)
      );
      await UpdateRepublish.run(privateKeyPathArg);
    } else {
      Log.debug(
        'Rolling back to the embedded update with private key path: ' +
          JSON.stringify(privateKeyPathArg)
      );
      await UpdateRollBackToEmbedded.run(privateKeyPathArg);
    }
  }
}
