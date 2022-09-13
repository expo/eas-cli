import { EasJsonAccessor, EasJsonUtils } from '@expo/eas-json';
import * as PackageManagerUtils from '@expo/package-manager';
import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import fs from 'fs-extra';
// eslint-disable-next-line no-restricted-imports
import { Options, Ora } from 'ora';
import path from 'path';
import semver from 'semver';

import {
  AnalyticsEvent,
  flushAsync as flushAnalyticsAsync,
  initAsync as initAnalyticsAsync,
  logEvent,
} from '../analytics/rudderstackClient';
import Log, { learnMore } from '../log';
import { interactiveOra, nonInteractiveOra } from '../ora';
import { findProjectRootAsync } from '../project/projectUtils';
import { InteractivePrompts, NonInteractivePrompts, Prompts } from '../prompts';
import { getUserAsync } from '../user/User';
import { ensureLoggedInAsync } from '../user/actions';
import { easCliVersion } from '../utils/easCli';
import { setVcsClient } from '../vcs';
import GitClient from '../vcs/clients/git';

type CommandOptions =
  | {
      nonInteractive: true;
      json: true;
    }
  | {
      nonInteractive: boolean;
      json: false;
    };

export type CommandContext = Readonly<
  CommandOptions & {
    logger: Log;
    prompts: Prompts;
    ora: (options?: Options | string) => Ora;
  }
>;

export default abstract class EasCommand extends Command {
  static override globalFlags = {
    json: Flags.boolean({
      description: 'Enable JSON output, non-JSON messages will be printed to stderr.',
      dependsOn: ['non-interactive'],
    }),
    'non-interactive': Flags.boolean({
      description: 'Run the command in non-interactive mode.',
    }),
  };

  // disable built in oclif json stuff
  enableJsonFlag = false;

  /**
   * When user data is unavailable locally, determines if the command will
   * force the user to log in
   */
  protected requiresAuthentication = true;
  protected mustBeRunInsideProject = true;

  protected abstract runAsync({
    nonInteractive,
    json,
    logger,
    prompts: {
      promptAsync,
      confirmAsync,
      selectAsync,
      toggleConfirmAsync,
      pressAnyKeyToContinueAsync,
    },
    ora,
  }: CommandContext): Promise<{ jsonOutput: object }>;

  // eslint-disable-next-line async-protect/async-suffix
  async run(): Promise<any> {
    const { flags } = await this.parse();
    const json = flags.json ?? false;
    const nonInteractive = (flags as any)['non-interactive'] ?? false;

    await initAnalyticsAsync();

    if (this.mustBeRunInsideProject) {
      const projectDir = await findProjectRootAsync();
      await this.applyCliConfigAsync(projectDir);
      await this.ensureEasCliIsNotInDependenciesAsync(projectDir);
    }

    if (this.requiresAuthentication) {
      await ensureLoggedInAsync({ nonInteractive });
    } else {
      await getUserAsync();
    }
    logEvent(AnalyticsEvent.ACTION, {
      // id is assigned by oclif in constructor based on the filepath:
      // commands/submit === submit, commands/build/list === build:list
      action: `eas ${this.id}`,
    });

    const jsonOutput = await this.runAsync({
      nonInteractive,
      json: json ?? false,
      logger: new Log(json),
      prompts: nonInteractive ? new InteractivePrompts() : new NonInteractivePrompts(),
      ora: nonInteractive ? nonInteractiveOra : interactiveOra,
    });

    if (json) {
      this.printJsonOnlyOutput(jsonOutput);
    }
  }

  // eslint-disable-next-line async-protect/async-suffix
  override async finally(err: Error): Promise<any> {
    await flushAnalyticsAsync();
    return super.finally(err);
  }

  private async applyCliConfigAsync(projectDir: string): Promise<void> {
    const easJsonAccessor = new EasJsonAccessor(projectDir);
    const config = await EasJsonUtils.getCliConfigAsync(easJsonAccessor);
    if (config?.version && !semver.satisfies(easCliVersion, config.version)) {
      throw new Error(
        `You are on eas-cli@${easCliVersion} which does not satisfy the CLI version constraint in eas.json (${config.version})`
      );
    }
    if (config?.requireCommit) {
      setVcsClient(new GitClient());
    }
  }

  private async ensureEasCliIsNotInDependenciesAsync(projectDir: string): Promise<void> {
    let printCliVersionWarning = false;

    const consoleWarn = (msg?: string): void => {
      if (msg) {
        // eslint-disable-next-line no-console
        console.warn(chalk.yellow(msg));
      } else {
        // eslint-disable-next-line no-console
        console.warn();
      }
    };

    if (await this.isEasCliInDependenciesAsync(projectDir)) {
      printCliVersionWarning = true;
      consoleWarn(`Found ${chalk.bold('eas-cli')} in your project dependencies.`);
    }

    const maybeRepoRoot = PackageManagerUtils.findWorkspaceRoot(projectDir) ?? projectDir;
    if (maybeRepoRoot !== projectDir && (await this.isEasCliInDependenciesAsync(maybeRepoRoot))) {
      printCliVersionWarning = true;
      consoleWarn(`Found ${chalk.bold('eas-cli')} in your monorepo dependencies.`);
    }

    if (printCliVersionWarning) {
      consoleWarn(
        `It's recommended to use the ${chalk.bold(
          '"cli.version"'
        )} field in eas.json to enforce the ${chalk.bold('eas-cli')} version for your project.`
      );
      consoleWarn(
        learnMore('https://github.com/expo/eas-cli#enforcing-eas-cli-version-for-your-project')
      );
      consoleWarn();
    }
  }

  private async isEasCliInDependenciesAsync(dir: string): Promise<boolean> {
    const packageJsonPath = path.join(dir, 'package.json');
    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
    return (
      packageJson?.dependencies?.['eas-cli'] !== undefined ||
      packageJson?.devDependencies?.['eas-cli'] !== undefined
    );
  }

  private printJsonOnlyOutput(value: object): void {
    try {
      new Log(false).log(JSON.stringify(this.sanitizeValue(value), null, 2));
    } catch {}
  }

  private sanitizeValue(value: any): unknown {
    if (Array.isArray(value)) {
      return value.map(val => this.sanitizeValue(val));
    } else if (value && typeof value === 'object') {
      const result: Record<string, any> = {};
      Object.keys(value).forEach(key => {
        if (key !== '__typename' && value[key] !== null) {
          result[key] = this.sanitizeValue(value[key]);
        }
      });
      return result;
    } else {
      return value;
    }
  }
}
