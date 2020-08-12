import { Command, flags } from '@oclif/command';

export default class WebhookUpdate extends Command {
  static description = 'update a webhook for a project';

  static examples = ['$ eas webhook:update'];

  static flags = {
    url: flags.string({ description: 'name to print' }),
    event: flags.enum({ options: ['build'] }),
  };

  async run() {
    // const { flags } = this.parse(Update);
    throw new Error('Not implemented');
  }
}
