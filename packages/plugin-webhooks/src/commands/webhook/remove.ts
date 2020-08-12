import { Command } from '@oclif/command';

export default class WebhookRemove extends Command {
  static description = 'delete a webhook';

  static flags = {};

  async run() {
    // const { flags } = this.parse(List);
    throw new Error('Not implemented');
  }
}
