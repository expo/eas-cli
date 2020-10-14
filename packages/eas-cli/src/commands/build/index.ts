import { Command } from '@oclif/command';

export default class BuildIndex extends Command {
  static description = 'build an app binary for your project';

  async run() {
    this._help();
  }
}
