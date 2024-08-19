import { Flags } from '@oclif/core';

import UpdateRepublish from './republish';
import UpdateRollBackToEmbedded from './roll-back-to-embedded';
import EasCommand from '../../commandUtils/EasCommand';
import { promptAsync } from '../../prompts';

export default class UpdateRollback extends EasCommand {
  static override description = 'roll back to an embedded update or an existing update';

  static override flags = {
    'private-key-path': Flags.string({
      description: `File containing the PEM-encoded private key corresponding to the certificate in expo-updates' configuration. Defaults to a file named "private-key.pem" in the certificate's directory. Only relevant if you are using code signing: https://docs.expo.dev/eas-update/code-signing/`,
      required: false,
    }),
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(UpdateRollback);

    const { choice } = await promptAsync({
      type: 'select',
      message: 'Which type of update would you like to roll back to?',
      name: 'choice',
      choices: [
        { title: 'Published Update', value: 'published' },
        { title: 'Embedded Update', value: 'embedded' },
      ],
    });

    const privateKeyPathArg = flags['private-key-path']
      ? ['--private-key-path', flags['private-key-path']]
      : [];
    if (choice === 'published') {
      await UpdateRepublish.run(privateKeyPathArg);
    } else {
      await UpdateRollBackToEmbedded.run(privateKeyPathArg);
    }
  }
}
