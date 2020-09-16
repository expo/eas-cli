import { Command, flags } from '@oclif/command';

export default class BuildStatus extends Command {
  static description = 'get the status of the latest builds for your project';

  static flags = {
    platform: flags.enum({ options: ['all', 'android', 'ios'] }),
    status: flags.enum({ options: ['in-queue', 'in-progress', 'errored', 'finished'] }),
  };

  async run() {
    // const { flags } = this.parse(Add);
    throw new Error('Not implemented');
  }
}
