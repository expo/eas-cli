import { Flags } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import Log from '../../log';
import { loadConfigAsync } from '../../metadata/config/resolve';
import { createMetadataContextAsync } from '../../metadata/context';
import { MetadataValidationError, logMetadataValidationError } from '../../metadata/errors';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

export default class MetadataLint extends EasCommand {
  static override description = 'validate the local store configuration';

  static override flags = {
    json: Flags.boolean({
      description: 'Enable JSON output, non-JSON messages will be printed to stderr',
      default: false,
    }),
    profile: Flags.string({
      description:
        'Name of the submit profile from eas.json. Defaults to "production" if defined in eas.json.',
    }),
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectConfig,
  };

  async runAsync(): Promise<void> {
    Log.warn('EAS Metadata is in beta and subject to breaking changes.');

    const { flags } = await this.parse(MetadataLint);
    const {
      projectConfig: { exp, projectDir },
    } = await this.getContextAsync(MetadataLint, {
      nonInteractive: false,
    });

    if (flags.json) {
      enableJsonOutput();
    }

    // this command is interactive (all nonInteractive flags passed to utility functions are false)
    // await getProjectIdAsync(exp, { nonInteractive: false });
    // await ensureProjectConfiguredAsync({ projectDir, nonInteractive: false });

    const metadataCtx = await createMetadataContextAsync({
      projectDir,
      exp,
      profileName: flags.profile,
    });

    try {
      await loadConfigAsync(metadataCtx);

      if (flags.json) {
        return printJsonOnlyOutput([]);
      }

      Log.log('✅ Store configuration is valid.');
    } catch (error) {
      if (!(error instanceof MetadataValidationError)) {
        throw error;
      }

      if (flags.json) {
        return printJsonOnlyOutput(error.errors);
      }

      logMetadataValidationError(error);
      Log.addNewLineIfNone();
    }
  }
}
