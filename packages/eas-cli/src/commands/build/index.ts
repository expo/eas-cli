import { Command } from '@oclif/command';

export default class BuildIndex extends Command {
  static description = 'build an app binary for your project';

  static flags = {};

  async run() {
    throw new Error('Not implemented');
  }
}
