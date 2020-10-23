import { Command } from '@oclif/command';

export default class BuildConfigure extends Command {
  static description = 'Start a build';

  static flags = {};

  async run() {
    // const { flags } = this.parse(Add);
    throw new Error('Not implemented');
  }
}
