import { Command } from '@oclif/command';

export default class UpdateIndex extends Command {
  static description = 'create a revision for given channel';

  static aliases = ['update:publish'];

  async run() {
    throw new Error('Not implemented');
  }
}
