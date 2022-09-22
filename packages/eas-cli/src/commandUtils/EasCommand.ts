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
import { getExpoConfig } from '../project/expoConfig';
import { findProjectRootAsync, getProjectIdAsync } from '../project/projectUtils';
import { Actor, getUserAsync } from '../user/User';
import { ensureLoggedInAsync } from '../user/actions';
import { easCliVersion } from '../utils/easCli';
import { setVcsClient } from '../vcs';
import GitClient from '../vcs/clients/git';

export interface CommandConfiguration {
  /**
   * Whether a command can be run outside of an Expo project directory.
   * By default, all commands must be run inside an Expo project directory.
   */
  canRunOutsideProject?: boolean;
}

export interface ContextOptions {
  nonInteractive: boolean;
}

export abstract class ContextField<T> {
  abstract getValueAsync(options: ContextOptions): Promise<T>;
}

export class ProjectIdContextField extends ContextField<string> {
  async getValueAsync({ nonInteractive }: ContextOptions): Promise<string> {
    const projectDir = await findProjectRootAsync();
    const exp = getExpoConfig(projectDir);
    return await getProjectIdAsync(exp, { nonInteractive });
  }
}

export class OptionalProjectIdContextField extends ContextField<string | undefined> {
  async getValueAsync({ nonInteractive }: ContextOptions): Promise<string | undefined> {
    const projectDir = await findProjectRootAsync();
    if (!projectDir) {
      return undefined;
    }

    const exp = getExpoConfig(projectDir);
    return await getProjectIdAsync(exp, { nonInteractive });
  }
}

export class ActorContextField extends ContextField<Actor> {
  async getValueAsync({ nonInteractive }: ContextOptions): Promise<Actor> {
    return await ensureLoggedInAsync({ nonInteractive });
  }
}

export const EASCommandProjectIdContext = {
  projectId: new ProjectIdContextField(),
};

export const EASCommandProjectIdIfProjectDirContext = {
  projectId: new OptionalProjectIdContextField(),
};

export const EASCommandLoggedInContext = {
  actor: new ActorContextField(),
};

type ContextInput<
  T extends {
    [name: string]: any;
  } = object
> = {
  [P in keyof T]: ContextField<T[P]>;
};

type ContextOutput<
  T extends {
    [name: string]: any;
  } = object
> = {
  [P in keyof T]: T[P];
};

export default abstract class EasCommand extends Command {
  static contextDefinition: ContextInput = {};

  protected commandConfiguration: CommandConfiguration = {};

  protected async getContextAsync<
    C extends {
      [name: string]: any;
    } = object
  >(
    commandClass: { contextDefinition: ContextInput<C> },
    { nonInteractive }: { nonInteractive: boolean }
  ): Promise<ContextOutput<C>> {
    const contextDefinition = commandClass.contextDefinition;

    const contextValuePairs = await Promise.all(
      Object.keys(contextDefinition).map(async contextKey => {
        return [contextKey, await contextDefinition[contextKey].getValueAsync({ nonInteractive })];
      })
    );

    return Object.fromEntries(contextValuePairs);
  }

  protected abstract runAsync(): Promise<any>;

  // eslint-disable-next-line async-protect/async-suffix
  async run(): Promise<any> {
    await initAnalyticsAsync();

    if (!this.commandConfiguration.canRunOutsideProject) {
      const projectDir = await findProjectRootAsync();
      await this.applyCliConfigAsync(projectDir);
      await this.ensureEasCliIsNotInDependenciesAsync(projectDir);
    }

    // this is needed for logEvent call below as it identifies the user in the analytics system
    await getUserAsync();
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
