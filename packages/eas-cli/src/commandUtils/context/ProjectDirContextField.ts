import { EasJsonAccessor, EasJsonUtils } from '@expo/eas-json';
import * as PackageManagerUtils from '@expo/package-manager';
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';
import pkgDir from 'pkg-dir';
import semver from 'semver';

import { learnMore } from '../../log';
import { easCliVersion } from '../../utils/easCli';
import { getVcsClient, setVcsClient } from '../../vcs';
import GitClient from '../../vcs/clients/git';
import ContextField from './ContextField';

export default class ProjectDirContextField extends ContextField<string> {
  async getValueAsync(): Promise<string> {
    return await ProjectDirContextField.findProjectDirAndVerifyProjectSetupAsync();
  }

  private static async applyCliConfigAsync(projectDir: string): Promise<void> {
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

  private static async ensureEasCliIsNotInDependenciesAsync(projectDir: string): Promise<void> {
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

  private static async isEasCliInDependenciesAsync(dir: string): Promise<boolean> {
    const packageJsonPath = path.join(dir, 'package.json');
    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
    return (
      packageJson?.dependencies?.['eas-cli'] !== undefined ||
      packageJson?.devDependencies?.['eas-cli'] !== undefined
    );
  }

  /**
   * Get the project root directory.
   */
  private static async findProjectRootAsync(): Promise<string> {
    const projectRootDir = await pkgDir();
    if (!projectRootDir) {
      throw new Error('Run this command inside a project directory.');
    } else {
      let vcsRoot;
      try {
        vcsRoot = path.normalize(await getVcsClient().getRootPathAsync());
      } catch {}
      if (vcsRoot && vcsRoot.startsWith(projectRootDir) && vcsRoot !== projectRootDir) {
        throw new Error(
          `package.json is outside of the current git repository (project root: ${projectRootDir}, git root: ${vcsRoot}).`
        );
      }
      return projectRootDir;
    }
  }

  private static async findProjectDirAndVerifyProjectSetupAsync(): Promise<string> {
    const projectDir = await this.findProjectRootAsync();
    await this.applyCliConfigAsync(projectDir);
    await this.ensureEasCliIsNotInDependenciesAsync(projectDir);
    return projectDir;
  }
}
