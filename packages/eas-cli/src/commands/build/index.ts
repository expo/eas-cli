import { Errors, Flags } from '@oclif/core';
import path from 'path';

import { BuildFlags, runBuildAndSubmitAsync } from '../../build/runBuildAndSubmit';
import { UserInputResourceClass } from '../../build/types';
import EasCommand from '../../commandUtils/EasCommand';
import Log from '../../log';
import { RequestedPlatform, selectRequestedPlatformAsync } from '../../platform';
import { findProjectRootAsync } from '../../project/projectUtils';
import { enableJsonOutput } from '../../utils/json';

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
}

export default class Build extends EasCommand {
  static description = 'start a build';

  static flags = {
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
      description: 'The resource class that will be used to run this build [experimental] ',
    }),
  };

  async runAsync(): Promise<void> {
    const { flags: rawFlags } = await this.parse(Build);
    if (rawFlags.json) {
      enableJsonOutput();
    }
    const flags = await this.sanitizeFlagsAsync(rawFlags);

    const projectDir = await findProjectRootAsync();

    await runBuildAndSubmitAsync(projectDir, flags);
  }

  private async sanitizeFlagsAsync(flags: RawBuildFlags): Promise<BuildFlags> {
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

    const requestedPlatform = await selectRequestedPlatformAsync(flags.platform);
    if (flags.local) {
      if (flags['auto-submit'] || flags['auto-submit-with-profile'] !== undefined) {
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
    if (flags['resource-class'] && !Object.values(UserInputResourceClass).includes(flags['resource-class'])) {
      Errors.error(`Invalid resource-class: '${flags['resource-class']}'`, { exit: 1 });
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
      resourceClass: flags['resource-class'],
    };
  }
}
