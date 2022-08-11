import { Flags } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import Log, { learnMore } from '../../log';

export default class MetadataLint extends EasCommand {
  static description = 'validate the local store configuration';

  static flags = {
    json: Flags.boolean({
      description: 'Enable JSON output, non-JSON messages will be printed to stderr',
      default: false,
    }),
    profile: Flags.string({
      description:
        'Name of the submit profile from eas.json. Defaults to "production" if defined in eas.json.',
    }),
  };

  async runAsync(): Promise<void> {
    Log.warn('EAS Metadata is in beta and subject to breaking changes.');


  }
}
