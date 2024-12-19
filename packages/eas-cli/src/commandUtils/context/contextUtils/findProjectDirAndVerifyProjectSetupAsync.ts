import { EasJsonAccessor, EasJsonUtils } from '@expo/eas-json';
import * as PackageManagerUtils from '@expo/package-manager';
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';
import pkgDir from 'pkg-dir';
import semver from 'semver';

import { learnMore } from '../../../log';
import { easCliVersion } from '../../../utils/easCli';
import { resolveVcsClient } from '../../../vcs';

async function applyCliConfigAsync(projectDir: string): Promise<void> {
  const easJsonAccessor = EasJsonAccessor.fromProjectPath(projectDir);
  const config = await EasJsonUtils.getCliConfigAsync(easJsonAccessor);
  if (config?.version && !semver.satisfies(easCliVersion, config.version)) {
    throw new Error(
      `You are on eas-cli@${easCliVersion} which does not satisfy the CLI version constraint defined in eas.json (${
        config.version
      }).\n\nThis error probably means that you need update your eas-cli to a newer version.\nRun ${chalk.bold(
        'npm install -g eas-cli'
      )} to update the eas-cli to the latest version.`
    );
  }
}

async function ensureEasCliIsNotInDependenciesAsync(projectDir: string): Promise<void> {
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

  if (await isEasCliInDependenciesAsync(projectDir)) {
    printCliVersionWarning = true;
    consoleWarn(`Found ${chalk.bold('eas-cli')} in your project dependencies.`);
  }

  const maybeRepoRoot = PackageManagerUtils.resolveWorkspaceRoot(projectDir) ?? projectDir;
  if (maybeRepoRoot !== projectDir && (await isEasCliInDependenciesAsync(maybeRepoRoot))) {
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

async function isEasCliInDependenciesAsync(dir: string): Promise<boolean> {
  const packageJsonPath = path.join(dir, 'package.json');
  const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
  return (
    packageJson?.dependencies?.['eas-cli'] !== undefined ||
    packageJson?.devDependencies?.['eas-cli'] !== undefined
  );
}

/**
 * @returns the project root directory.
 *
 * @deprecated Should not be used outside of context functions.
 */
export async function findProjectRootAsync({
  cwd,
  defaultToProcessCwd = false,
}: {
  cwd?: string;
  defaultToProcessCwd?: boolean;
} = {}): Promise<string> {
  const projectRootDir = await pkgDir(cwd);
  if (!projectRootDir) {
    if (!defaultToProcessCwd) {
      throw new Error('Run this command inside a project directory.');
    } else {
      return process.cwd();
    }
  } else {
    let vcsRoot;
    try {
      vcsRoot = path.normalize(await resolveVcsClient().getRootPathAsync());
    } catch {}
    if (vcsRoot && vcsRoot.startsWith(projectRootDir) && vcsRoot !== projectRootDir) {
      throw new Error(
        `package.json is outside of the current git repository (project root: ${projectRootDir}, git root: ${vcsRoot}.`
      );
    }
    return projectRootDir;
  }
}

let ranEnsureEasCliIsNotInDependencies = false;

/**
 * Determine the project root directory and ensure some constraints about the project setup
 * like CLI version and dependencies.
 * @returns the project root directory
 *
 * @deprecated Should not be used outside of context functions.
 */
export async function findProjectDirAndVerifyProjectSetupAsync(): Promise<string> {
  const projectDir = await findProjectRootAsync();
  await applyCliConfigAsync(projectDir);
  if (!ranEnsureEasCliIsNotInDependencies) {
    ranEnsureEasCliIsNotInDependencies = true;
    await ensureEasCliIsNotInDependenciesAsync(projectDir);
  }
  return projectDir;
}
