import { Platform } from '@expo/eas-build-job';
import { EasJsonAccessor } from '@expo/eas-json';
import { Flags } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import Log from '../../log';
import { loadConfigAsync } from '../../metadata/config/resolve';
import { MetadataValidationError, logMetadataValidationError } from '../../metadata/errors';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';
import { getProfilesAsync } from '../../utils/profiles';

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
    // The metadata lint command is created to integrate in other dev tooling, like vscode-expo.
    // These integrations might spam this command, so we avoid communicating with our services here.
    // Note that this is an exception and you should normally use `ProjectConfig` instead.
    ...this.ContextOptions.ProjectDir,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(MetadataLint);
    const { projectDir } = await this.getContextAsync(MetadataLint, {
      nonInteractive: true,
    });

    if (flags.json) {
      enableJsonOutput();
    } else {
      Log.warn('EAS Metadata is in beta and subject to breaking changes.');
    }

    const submitProfiles = await getProfilesAsync({
      type: 'submit',
      easJsonAccessor: EasJsonAccessor.fromProjectPath(projectDir),
      platforms: [Platform.IOS],
      profileName: flags.profile,
      projectDir,
    });

    if (submitProfiles.length !== 1) {
      throw new Error('Metadata only supports iOS and a single submit profile.');
    }

    const submitProfile = submitProfiles[0].profile;

    try {
      await loadConfigAsync({ projectDir, profile: submitProfile });

      if (flags.json) {
        printJsonOnlyOutput([]);
        return;
      }

      Log.log('✅ Store configuration is valid.');
    } catch (error) {
      if (!(error instanceof MetadataValidationError)) {
        throw error;
      }

      if (flags.json) {
        printJsonOnlyOutput(error.errors);
        return;
      }

      logMetadataValidationError(error);
      Log.addNewLineIfNone();
    }
  }
}
