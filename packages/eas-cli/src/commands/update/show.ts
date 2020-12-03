import { Command } from '@oclif/command';

export default class UpdateShow extends Command {
  static hidden = true;
  static description = 'details about a particular revision';

  async run() {
    throw new Error('Not implemented');
  }
}
