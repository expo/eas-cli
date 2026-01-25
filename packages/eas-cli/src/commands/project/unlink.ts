import { getProjectConfigDescription } from '@expo/config';
import { Flags } from '@oclif/core';
import chalk from 'chalk';

import EasCommand from '../../commandUtils/EasCommand';
import { EASNonInteractiveFlag } from '../../commandUtils/flags';
import { AppQuery } from '../../graphql/queries/AppQuery';
import Log from '../../log';
import {
  createOrModifyExpoConfigAsync,
  getPrivateExpoConfigAsync,
  isUsingStaticExpoConfig,
} from '../../project/expoConfig';
import { confirmAsync } from '../../prompts';

export default class ProjectUnlink extends EasCommand {
  static override description = 'unlink a local project from an EAS project';
  static override aliases = ['unlink'];

  static override flags = {
    force: Flags.boolean({
      description: 'Skip confirmation prompt',
    }),
    ...EASNonInteractiveFlag,
  };

  static override contextDefinition = {
    ...this.ContextOptions.MaybeLoggedIn,
    ...this.ContextOptions.ProjectDir,
  };

  async runAsync(): Promise<void> {
    const {
      flags: { force, 'non-interactive': nonInteractive },
    } = await this.parse(ProjectUnlink);
    const {
      maybeLoggedIn: { actor, graphqlClient },
      projectDir,
    } = await this.getContextAsync(ProjectUnlink, { nonInteractive });

    const exp = await getPrivateExpoConfigAsync(projectDir);
    const projectId = exp.extra?.eas?.projectId;

    if (!projectId) {
      Log.log('This project is not linked to an EAS project.');
      return;
    }

    // Try to fetch project name for better UX if logged in
    let projectName: string | null = null;
    if (actor) {
      try {
        const app = await AppQuery.byIdAsync(graphqlClient, projectId);
        projectName = `@${app.ownerAccount.name}/${app.slug}`;
      } catch {
        // Ignore errors - user might not have access to the project
      }
    }

    const displayName = projectName ?? projectId;

    // Require confirmation unless --force is passed
    if (!force) {
      if (nonInteractive) {
        throw new Error(
          `This project is linked to ${chalk.bold(
            displayName
          )}. Use --force flag to unlink in non-interactive mode.`
        );
      }

      const confirmed = await confirmAsync({
        message: `Unlink this project from ${chalk.bold(displayName)}?`,
      });
      if (!confirmed) {
        Log.log('Aborted.');
        return;
      }
    }

    // Check if using dynamic config
    if (!isUsingStaticExpoConfig(projectDir)) {
      Log.warn();
      Log.warn(
        `Warning: Your project uses dynamic app configuration, and cannot be automatically modified.`
      );
      Log.warn(
        chalk.dim(
          'https://docs.expo.dev/workflow/configuration/#dynamic-configuration-with-appconfigjs'
        )
      );
      Log.warn();
      Log.warn(
        `To unlink from EAS, remove the following from your ${chalk.bold(
          getProjectConfigDescription(projectDir)
        )}:`
      );
      Log.warn();
      Log.warn(chalk.bold('  extra.eas.projectId'));
      if (exp.updates?.url && this.isEasUpdateUrl(exp.updates.url)) {
        Log.warn(chalk.bold('  updates.url'));
      }
      Log.warn();
      throw new Error('Cannot automatically modify dynamic app configuration.');
    }

    // Remove extra.eas.projectId by setting it to undefined
    const newExtra = { ...exp.extra };
    if (newExtra.eas) {
      const { projectId: _, ...restEas } = newExtra.eas;
      if (Object.keys(restEas).length === 0) {
        delete newExtra.eas;
      } else {
        newExtra.eas = restEas;
      }
    }

    // Remove updates.url if it matches EAS Update URL pattern
    let updatesUrlRemoved = false;
    const modifications: Record<string, unknown> = { extra: newExtra };

    if (exp.updates?.url && this.isEasUpdateUrl(exp.updates.url)) {
      const { url: _, ...restUpdates } = exp.updates;
      if (Object.keys(restUpdates).length === 0) {
        modifications.updates = undefined;
      } else {
        modifications.updates = restUpdates;
      }
      updatesUrlRemoved = true;
    }

    const result = await createOrModifyExpoConfigAsync(projectDir, modifications);

    if (result.type !== 'success') {
      throw new Error(result.message ?? 'Failed to modify app configuration.');
    }

    Log.withTick(`Removed ${chalk.bold('extra.eas.projectId')} from app config`);
    if (updatesUrlRemoved) {
      Log.withTick(`Removed ${chalk.bold('updates.url')} from app config`);
    }
    Log.succeed('Project unlinked successfully.');
  }

  private isEasUpdateUrl(url: string): boolean {
    // Match EAS Update URLs: https://u.expo.dev/*, https://staging-u.expo.dev/*
    return /^https:\/\/(staging-)?u\.expo\.dev\//.test(url);
  }
}
