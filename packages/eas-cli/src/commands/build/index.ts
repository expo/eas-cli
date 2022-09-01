import { Errors, Flags } from '@oclif/core';
import path from 'path';

import { BuildFlags, runBuildAndSubmitAsync } from '../../build/runBuildAndSubmit';
import { UserInputResourceClass } from '../../build/types';
import EasCommand from '../../commandUtils/EasCommand';
import { StatuspageServiceName } from '../../graphql/generated';
import Log from '../../log';
import { RequestedPlatform, selectRequestedPlatformAsync } from '../../platform';
import { findProjectRootAsync } from '../../project/projectUtils';
import { enableJsonOutput } from '../../utils/json';
import { maybeWarnAboutEasOutagesAsync } from '../../utils/statuspageService';

interface RawBuildFlags {
  platform?: string;
  'skip-credentials-check': boolean;
  'skip-project-configuration': boolean;
  profile?: string;
  'non-interactive': boolean;
  local: boolean;
  output?: string;
  wait: boolean;
  'clear-cache': boolean;
  json: boolean;
  'auto-submit': boolean;
  'auto-submit-with-profile'?: string;
  'resource-class'?: UserInputResourceClass;
  message?: string;
}

export default class Build extends EasCommand {
  static override description = 'start a build';

  static override flags = {
    platform: Flags.enum({
      char: 'p',
      options: ['android', 'ios', 'all'],
    }),
    'skip-credentials-check': Flags.boolean({
      default: false,
      hidden: true,
    }),
    json: Flags.boolean({
      description: 'Enable JSON output, non-JSON messages will be printed to stderr',
      default: false,
    }),
    'skip-project-configuration': Flags.boolean({
      default: false,
      hidden: true,
    }),
    profile: Flags.string({
      description:
        'Name of the build profile from eas.json. Defaults to "production" if defined in eas.json.',
      helpValue: 'PROFILE_NAME',
    }),
    'non-interactive': Flags.boolean({
      default: false,
      description: 'Run command in non-interactive mode',
    }),
    local: Flags.boolean({
      default: false,
      description: 'Run build locally [experimental]',
    }),
    output: Flags.string({
      description: 'Output path for local build',
    }),
    wait: Flags.boolean({
      default: true,
      allowNo: true,
      description: 'Wait for build(s) to complete',
    }),
    'clear-cache': Flags.boolean({
      default: false,
      description: 'Clear cache before the build',
    }),
    'auto-submit': Flags.boolean({
      default: false,
      description:
        'Submit on build complete using the submit profile with the same name as the build profile',
      exclusive: ['auto-submit-with-profile'],
    }),
    'auto-submit-with-profile': Flags.string({
      description: 'Submit on build complete using the submit profile with provided name',
      helpValue: 'PROFILE_NAME',
      exclusive: ['auto-submit'],
    }),
    'resource-class': Flags.enum({
      options: Object.values(UserInputResourceClass),
      hidden: true,
      description: 'The instance type that will be used to run this build [experimental]',
    }),
    message: Flags.string({
      char: 'm',
      description: 'A short message describing the build',
    }),
  };

  async runAsync(): Promise<void> {
    const { flags: rawFlags } = await this.parse(Build);

    if (rawFlags.json) {
      enableJsonOutput();
    }
    const flags = this.sanitizeFlags(rawFlags);

    const projectDir = await findProjectRootAsync();

    if (!flags.localBuildOptions.enable) {
      await maybeWarnAboutEasOutagesAsync(
        flags.autoSubmit
          ? [StatuspageServiceName.EasBuild, StatuspageServiceName.EasSubmit]
          : [StatuspageServiceName.EasBuild]
      );
    }

    const flagsWithPlatform = await this.ensurePlatformSelectedAsync(flags);

    await runBuildAndSubmitAsync(projectDir, flagsWithPlatform);
  }

  private sanitizeFlags(
    flags: RawBuildFlags
  ): Omit<BuildFlags, 'requestedPlatform'> & { requestedPlatform?: RequestedPlatform } {
    const nonInteractive = flags['non-interactive'];
    if (!flags.local && flags.output) {
      Errors.error('--output is allowed only for local builds', { exit: 1 });
    }
    if (!flags.platform && nonInteractive) {
      Errors.error('--platform is required when building in non-interactive mode', { exit: 1 });
    }
    if (flags.json && !nonInteractive) {
      Errors.error('--json is allowed only when building in non-interactive mode', { exit: 1 });
    }

    const requestedPlatform =
      flags.platform &&
      Object.values(RequestedPlatform).includes(flags.platform.toLowerCase() as RequestedPlatform)
        ? (flags.platform.toLowerCase() as RequestedPlatform)
        : undefined;

    if (flags['skip-credentials-check']) {
      Log.warnDeprecatedFlag(
        'skip-credentials-check',
        'Build credentials validation is always skipped with the --non-interactive flag. You can also skip interactively.'
      );
      Log.newLine();
    }
    if (flags['skip-project-configuration']) {
      Log.warnDeprecatedFlag(
        'skip-project-configuration',
        'Automatic configuration of native code is no longer optional.'
      );
      Log.newLine();
    }

    const message = flags['message'];
    if (message && message.length > 1024) {
      Errors.error('Message cannot be longer than 1024 characters.', { exit: 1 });
    }

    const profile = flags['profile'];
    return {
      requestedPlatform,
      profile,
      nonInteractive,
      localBuildOptions: flags['local']
        ? {
            enable: true,
            verbose: true,
            artifactPath: flags.output && path.resolve(process.cwd(), flags.output),
          }
        : {
            enable: false,
          },
      wait: flags['wait'],
      clearCache: flags['clear-cache'],
      json: flags['json'],
      autoSubmit: flags['auto-submit'] || flags['auto-submit-with-profile'] !== undefined,
      submitProfile: flags['auto-submit-with-profile'] ?? profile,
      userInputResourceClass: flags['resource-class'] ?? UserInputResourceClass.DEFAULT,
      message,
    };
  }

  private async ensurePlatformSelectedAsync(
    flags: Omit<BuildFlags, 'requestedPlatform'> & { requestedPlatform?: RequestedPlatform }
  ): Promise<BuildFlags> {
    const requestedPlatform = await selectRequestedPlatformAsync(flags.requestedPlatform);

    if (flags.localBuildOptions.enable) {
      if (flags.autoSubmit) {
        // TODO: implement this
        Errors.error('Auto-submits are not yet supported when building locally', { exit: 1 });
      }

      if (requestedPlatform === RequestedPlatform.All) {
        Errors.error('Builds for multiple platforms are not supported with flag --local', {
          exit: 1,
        });
      } else if (process.platform !== 'darwin' && requestedPlatform === RequestedPlatform.Ios) {
        Errors.error('Unsupported platform, macOS is required to build apps for iOS', { exit: 1 });
      }
    }

    return {
      ...flags,
      requestedPlatform,
    };
  }
}
