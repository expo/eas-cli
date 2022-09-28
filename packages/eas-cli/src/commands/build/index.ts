import { Platform } from '@expo/eas-build-job';
import { EasJsonAccessor, EasJsonUtils } from '@expo/eas-json';
import { Errors, Flags } from '@oclif/core';
import chalk from 'chalk';
import figures from 'figures';
import path from 'path';

import { BuildFlags, runBuildAndSubmitAsync } from '../../build/runBuildAndSubmit';
import { UserInputResourceClass } from '../../build/types';
import EasCommand, {
  EASCommandDynamicProjectConfigContext,
  EASCommandLoggedInContext,
  EASCommandProjectDirContext,
} from '../../commandUtils/EasCommand';
import { EasNonInteractiveAndJsonFlags } from '../../commandUtils/flags';
import { StatuspageServiceName } from '../../graphql/generated';
import Log, { link } from '../../log';
import { RequestedPlatform, selectRequestedPlatformAsync } from '../../platform';
import { selectAsync } from '../../prompts';
import uniq from '../../utils/expodash/uniq';
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
    'skip-project-configuration': Flags.boolean({
      default: false,
      hidden: true,
    }),
    profile: Flags.string({
      char: 'e',
      description:
        'Name of the build profile from eas.json. Defaults to "production" if defined in eas.json.',
      helpValue: 'PROFILE_NAME',
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
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...EASCommandLoggedInContext,
    ...EASCommandDynamicProjectConfigContext,
    ...EASCommandProjectDirContext,
  };

  async runAsync(): Promise<void> {
    const { flags: rawFlags } = await this.parse(Build);

    if (rawFlags.json) {
      enableJsonOutput();
    }
    const flags = this.sanitizeFlags(rawFlags);

    const { actor, getDynamicProjectConfigAsync, projectDir } = await this.getContextAsync(Build, {
      nonInteractive: flags.nonInteractive,
    });

    await handleDeprecatedEasJsonAsync(projectDir, flags.nonInteractive);

    if (!flags.localBuildOptions.enable) {
      await maybeWarnAboutEasOutagesAsync(
        flags.autoSubmit
          ? [StatuspageServiceName.EasBuild, StatuspageServiceName.EasSubmit]
          : [StatuspageServiceName.EasBuild]
      );
    }

    const flagsWithPlatform = await this.ensurePlatformSelectedAsync(flags);

    await runBuildAndSubmitAsync(
      projectDir,
      flagsWithPlatform,
      actor,
      getDynamicProjectConfigAsync
    );
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

async function handleDeprecatedEasJsonAsync(
  projectDir: string,
  nonInteractive: boolean
): Promise<void> {
  const easJsonAccessor = new EasJsonAccessor(projectDir);
  const profileNames = await EasJsonUtils.getBuildProfileNamesAsync(easJsonAccessor);
  const platformAndProfileNames: [Platform, string][] = profileNames.flatMap(profileName => [
    [Platform.ANDROID, profileName],
    [Platform.IOS, profileName],
  ]);

  const deprecatedProfiles: [Platform, string][] = [];

  for (const [platform, profileName] of platformAndProfileNames) {
    const buildProfile = await EasJsonUtils.getBuildProfileAsync(
      easJsonAccessor,
      platform,
      profileName
    );
    if (buildProfile.artifactPath) {
      deprecatedProfiles.push([platform, profileName]);
    }
  }

  if (deprecatedProfiles.length === 0) {
    return;
  }

  const deprecatedProfileNames = uniq(deprecatedProfiles.map(([, profileName]) => profileName));
  Log.warn(`Some of your build profiles use deprecated field ${chalk.bold('artifactPath')}:`);
  for (const profileName of deprecatedProfileNames) {
    Log.warn(`- ${profileName}`);
  }
  Log.newLine();

  if (nonInteractive) {
    Log.warn(
      `${figures.warning} Action required: rename ${chalk.bold('artifactPath')} to ${chalk.bold(
        'applicationArchivePath'
      )} in all of the build profiles listed above.`
    );
    Log.warn(
      `See ${link('https://docs.expo.dev/build-reference/eas-json/')} for more information.`
    );
    Log.warn(
      `This warning will become an error in a future EAS CLI release. This build will continue to use the ${chalk.bold(
        'artifactPath'
      )} setting.`
    );
    return;
  }

  const rename = await selectAsync('Do you want us to handle renaming the field for you?', [
    { title: 'Yes', value: true },
    { title: 'No, I will edit eas.json manually (EAS CLI exits)', value: false },
  ]);

  if (!rename) {
    Errors.exit(1);
  }

  await easJsonAccessor.readRawJsonAsync();
  for (const [platform, profileName] of deprecatedProfiles) {
    easJsonAccessor.patch(easJsonRawObject => {
      easJsonRawObject.build[profileName][platform].applicationArchivePath =
        easJsonRawObject.build[profileName][platform].artifactPath;
      delete easJsonRawObject.build[profileName][platform].artifactPath;
      return easJsonRawObject;
    });
  }
  await easJsonAccessor.writeAsync();

  Log.withTick('Updated eas.json');
}
