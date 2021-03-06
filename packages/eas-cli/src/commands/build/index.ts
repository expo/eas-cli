import { ExpoConfig, getConfig } from '@expo/config';
import { EasJsonReader } from '@expo/eas-json';
import { flags } from '@oclif/command';
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';

import { configureAsync } from '../../build/configure';
import { createCommandContextAsync } from '../../build/context';
import { buildAsync } from '../../build/create';
import { RequestedPlatform } from '../../build/types';
import EasCommand from '../../commandUtils/EasCommand';
import Log, { learnMore } from '../../log';
import {
  isEasEnabledForProjectAsync,
  warnEasUnavailable,
} from '../../project/isEasEnabledForProject';
import { findProjectRootAsync, getProjectIdAsync } from '../../project/projectUtils';
import { confirmAsync, promptAsync } from '../../prompts';
import vcs from '../../vcs';

export default class Build extends EasCommand {
  static description = 'Start a build';

  static flags = {
    platform: flags.enum({ char: 'p', options: ['android', 'ios', 'all'] }),
    'skip-credentials-check': flags.boolean({
      default: false,
      hidden: true,
    }),
    'skip-project-configuration': flags.boolean({
      default: false,
      description: 'Skip project configuration',
    }),
    profile: flags.string({
      default: 'release',
      description: 'Name of the build profile from eas.json',
    }),
    'non-interactive': flags.boolean({
      default: false,
      description: 'Run command in --non-interactive mode',
    }),
    local: flags.boolean({
      default: false,
      description: 'Run build locally [experimental]',
    }),
    wait: flags.boolean({
      default: true,
      allowNo: true,
      description: 'Wait for build(s) to complete',
    }),
    'clear-cache': flags.boolean({
      default: false,
      description: 'Clear cache before the build',
    }),
  };

  async run(): Promise<void> {
    const { flags } = this.parse(Build);

    const nonInteractive = flags['non-interactive'];
    if (!flags.platform && nonInteractive) {
      throw new Error('--platform is required when building in non-interactive mode');
    }
    const platform =
      (flags.platform as RequestedPlatform | undefined) ?? (await promptForPlatformAsync());

    if (flags['skip-credentials-check']) {
      Log.warnDeprecatedFlag(
        'skip-credentials-check',
        'Build credential validation is always skipped with the --non-interactive flag. You can also skip interactively.'
      );
      Log.newLine();
    }

    const projectDir = (await findProjectRootAsync()) ?? process.cwd();
    let { exp } = getConfig(projectDir, { skipSDKVersionRequirement: true });
    const projectId = await getProjectIdAsync(exp);

    if (!flags.local && !(await isEasEnabledForProjectAsync(projectId))) {
      warnEasUnavailable();
      process.exitCode = 1;
      return;
    }

    if (flags.local && !verifyOptionsForLocalBuilds(platform)) {
      process.exitCode = 1;
      return;
    }

    exp = (await ensureProjectConfiguredAsync(projectDir, platform)) ?? exp;

    const commandCtx = await createCommandContextAsync({
      requestedPlatform: platform,
      profile: flags.profile,
      exp,
      projectDir,
      projectId,
      nonInteractive,
      clearCache: flags['clear-cache'],
      local: flags.local,
      skipProjectConfiguration: flags['skip-project-configuration'],
      waitForBuildEnd: flags.wait,
    });

    await buildAsync(commandCtx);
  }
}

function verifyOptionsForLocalBuilds(platform: RequestedPlatform): boolean {
  if (platform === RequestedPlatform.All) {
    Log.error('Builds for multiple platforms are not supported with flag --local');
    return false;
  } else if (process.platform !== 'darwin' && platform === RequestedPlatform.Ios) {
    Log.error('Unsupported platform, macOS is required to build apps for iOS');
    return false;
  } else {
    return true;
  }
}

async function promptForPlatformAsync(): Promise<RequestedPlatform> {
  const { platform } = await promptAsync({
    type: 'select',
    message: 'Build for platforms',
    name: 'platform',
    choices: [
      {
        title: 'All',
        value: RequestedPlatform.All,
      },
      {
        title: 'iOS',
        value: RequestedPlatform.Ios,
      },
      {
        title: 'Android',
        value: RequestedPlatform.Android,
      },
    ],
  });
  return platform;
}

async function ensureProjectConfiguredAsync(
  projectDir: string,
  platform: RequestedPlatform
): Promise<ExpoConfig | null> {
  const platformsToConfigure = await getPlatformsToConfigureAsync(projectDir, platform);

  if (!platformsToConfigure) {
    return null;
  }

  // Ensure the prompt is consistent with the platforms we need to configure
  let message = 'This project is not configured to build with EAS. Set it up now?';
  if (platformsToConfigure === RequestedPlatform.Ios) {
    message = 'Your iOS project is not configured to build with EAS. Set it up now?';
  } else if (platformsToConfigure === RequestedPlatform.Android) {
    message = 'Your Android project is not configured to build with EAS. Set it up now?';
  }

  const confirm = await confirmAsync({ message });
  if (confirm) {
    await configureAsync({
      projectDir,
      platform: platformsToConfigure,
    });
    if (await vcs.hasUncommittedChangesAsync()) {
      throw new Error(
        'Build process requires clean working tree, please commit all your changes and run `eas build` again'
      );
    }
    const { exp } = getConfig(projectDir, { skipSDKVersionRequirement: true });
    return exp;
  } else {
    throw new Error(
      `Aborting, please run ${chalk.bold('eas build:configure')} or create eas.json (${learnMore(
        'https://docs.expo.io/build/eas-json'
      )})`
    );
  }
}

async function getPlatformsToConfigureAsync(
  projectDir: string,
  platform: RequestedPlatform
): Promise<RequestedPlatform | null> {
  if (!(await fs.pathExists(path.join(projectDir, 'eas.json')))) {
    return platform;
  }

  const easConfig = await new EasJsonReader(projectDir, platform).readRawAsync();
  if (platform === RequestedPlatform.All) {
    if (easConfig.builds?.android && easConfig.builds?.ios) {
      return null;
    } else if (easConfig.builds?.ios) {
      return RequestedPlatform.Android;
    } else if (easConfig.builds?.android) {
      return RequestedPlatform.Ios;
    }
  } else if (
    (platform === RequestedPlatform.Android || platform === RequestedPlatform.Ios) &&
    easConfig.builds?.[platform]
  ) {
    return null;
  }

  return platform;
}
