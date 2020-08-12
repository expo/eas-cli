import { Command, flags } from '@oclif/command';

export default class WebhookAdd extends Command {
  static description = 'add webhook to a project';

  static examples = [
    `$ eas webhook:add
✅ Adding webhook to @expo/example`,
  ];

  static flags = {
    url: flags.string({ description: 'name to print' }),
    event: flags.enum({ options: ['build'] }),
  };

  async run() {
    // const { flags } = this.parse(Add);
    throw new Error('Not implemented');
  }
}
