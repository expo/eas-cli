import { Command } from '@oclif/command';

export default class WebhookList extends Command {
  static description = 'list all webhooks for a project';

  static examples = ['$ eas webhook:list'];

  static flags = {};

  async run() {}
}
