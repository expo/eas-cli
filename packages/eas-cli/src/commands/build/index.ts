import { EasJsonReader } from '@expo/eas-json';
import { Errors, Flags } from '@oclif/core';
import chalk from 'chalk';
import figures from 'figures';
import fs from 'fs-extra';
import path from 'path';

import { BuildFlags, runBuildAndSubmitAsync } from '../../build/runBuildAndSubmit';
import { ensureRepoIsCleanAsync, reviewAndCommitChangesAsync } from '../../build/utils/repository';
import EasCommand from '../../commandUtils/EasCommand';
import Log, { learnMore, link } from '../../log';
import { RequestedPlatform, selectRequestedPlatformAsync } from '../../platform';
import { findProjectRootAsync } from '../../project/projectUtils';
import { selectAsync } from '../../prompts';
import { easCliVersion } from '../../utils/easCli';
import { enableJsonOutput } from '../../utils/json';
import { getVcsClient, setVcsClient } from '../../vcs';
import GitClient from '../../vcs/clients/git';

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
}

export default class Build extends EasCommand {
  static description = 'Start a build';

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
      description: 'Skip project configuration',
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
      description: 'Output path for local build.',
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
  };

  async runAsync(): Promise<void> {
    const { flags: rawFlags } = await this.parse(Build);
    if (rawFlags.json) {
      enableJsonOutput();
    }
    const flags = await this.sanitizeFlagsAsync(rawFlags);

    const projectDir = await findProjectRootAsync();
    await handleDeprecatedEasJsonAsync(projectDir, flags.nonInteractive);

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

    const profile = flags['profile'];
    return {
      requestedPlatform,
      skipProjectConfiguration: flags['skip-project-configuration'],
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
    };
  }
}

export async function handleDeprecatedEasJsonAsync(
  projectDir: string,
  nonInteractive: boolean
): Promise<void> {
  const easJsonPath = EasJsonReader.formatEasJsonPath(projectDir);
  if (!(await fs.pathExists(easJsonPath))) {
    return;
  }
  const easJsonReader = new EasJsonReader(projectDir);
  const rawEasJson = await easJsonReader.readAsync();
  if (rawEasJson?.cli) {
    return;
  }

  if (nonInteractive) {
    Log.warn(
      `${
        figures.warning
      } Action required: the default behavior of EAS CLI has changed and your eas.json must be updated to remove ambiguity around which Git integration workflow to use. Refer to ${link(
        'https://expo.fyi/eas-vcs-workflow'
      )} for more information.`
    );
    Log.warn(
      'This warning will become an error in an upcoming EAS CLI release. For now, we will proceed with the old default behavior to avoid disruption of your builds.'
    );
    setVcsClient(new GitClient());
    return;
  }
  Log.log(
    `${chalk.bold(
      'eas-cli@>=0.34.0 no longer requires that you commit changes to Git before starting a build.'
    )} ${learnMore('https://expo.fyi/eas-vcs-workflow')}`
  );
  Log.log(
    `If you want to continue using the Git integration, you can opt in with ${chalk.bold(
      'cli.requireCommit'
    )} in ${chalk.bold('eas.json')} or with the following prompt.`
  );
  Log.newLine();

  const mode = await selectAsync('Select your preferred Git integration', [
    { title: 'Require changes to be committed in Git (old default)', value: 'requireCommit' },
    { title: 'Allow builds with dirty Git working tree (new default)', value: 'noCommit' },
  ]);

  if (mode === 'requireCommit') {
    setVcsClient(new GitClient());
    await ensureRepoIsCleanAsync(nonInteractive);
  }

  rawEasJson.cli =
    mode === 'requireCommit'
      ? { version: `>= ${easCliVersion}`, requireCommit: true }
      : { version: `>= ${easCliVersion}` };
  await fs.writeJSON(easJsonPath, rawEasJson, { spaces: 2 });
  Log.withTick('Updated eas.json');
  if (mode === 'requireCommit') {
    await getVcsClient().trackFileAsync(easJsonPath);
    await reviewAndCommitChangesAsync('Set cli.requireCommit to true in eas.json', {
      nonInteractive,
    });
  }
}
