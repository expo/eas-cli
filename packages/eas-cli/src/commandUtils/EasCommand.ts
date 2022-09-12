import { EasJsonAccessor, EasJsonUtils } from '@expo/eas-json';
import * as PackageManagerUtils from '@expo/package-manager';
import { Command } from '@oclif/core';
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';
import semver from 'semver';

import {
  AnalyticsEvent,
  flushAsync as flushAnalyticsAsync,
  initAsync as initAnalyticsAsync,
  logEvent,
} from '../analytics/rudderstackClient';
import { learnMore } from '../log';
import { findProjectRootAsync } from '../project/projectUtils';
import { getUserAsync } from '../user/User';
import { ensureLoggedInAsync } from '../user/actions';
import { easCliVersion } from '../utils/easCli';
import { setVcsClient } from '../vcs';
import GitClient from '../vcs/clients/git';

export default abstract class EasCommand extends Command {
  /**
   * When user data is unavailable locally, determines if the command will
   * force the user to log in
   */
  protected requiresAuthentication = true;
  protected mustBeRunInsideProject = true;

  protected abstract runAsync(): Promise<any>;

  // eslint-disable-next-line async-protect/async-suffix
  async run(): Promise<any> {
    await initAnalyticsAsync();

    if (this.mustBeRunInsideProject) {
      const projectDir = await findProjectRootAsync();
      await this.applyCliConfigAsync(projectDir);
      await this.ensureEasCliIsNotInDependenciesAsync(projectDir);
    }

    if (this.requiresAuthentication) {
      const { flags } = await this.parse();
      const nonInteractive = (flags as any)['non-interactive'] ?? false;
      await ensureLoggedInAsync({ nonInteractive });
    } else {
      await getUserAsync();
    }
    logEvent(AnalyticsEvent.ACTION, {
      // id is assigned by oclif in constructor based on the filepath:
      // commands/submit === submit, commands/build/list === build:list
      action: `eas ${this.id}`,
    });
    return this.runAsync();
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
}
