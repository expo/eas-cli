import { Flags } from '@oclif/core';

import { getExpoWebsiteBaseUrl } from '../../../api';
import EasCommand from '../../../commandUtils/EasCommand';
import { EasCommandError } from '../../../commandUtils/errors';
import {
  EasNonInteractiveAndJsonFlags,
  resolveNonInteractiveAndJsonFlags,
} from '../../../commandUtils/flags';
import { printGitHubRepository } from '../../../commandUtils/github';
import { GitHubAppInstallationStatus } from '../../../graphql/generated';
import { GitHubRepositoryMutation } from '../../../graphql/mutations/GitHubRepositoryMutation';
import { GitHubRepositoryQuery } from '../../../graphql/queries/GitHubRepositoryQuery';
import { ora } from '../../../ora';
import { promptAsync } from '../../../prompts';
import { enableJsonOutput } from '../../../utils/json';

export default class IntegrationsGitHubConnect extends EasCommand {
  static override description =
    'connect a GitHub repository to the current EAS project\nThe Expo GitHub app must already be installed and linked to the Expo account that owns the project. Authorize your GitHub account in your Expo personal settings before running this command. Supports github.com repositories.';

  static override examples = [
    '<%= config.bin %> <%= command.id %> --repo owner/repo',
    '<%= config.bin %> <%= command.id %> --repo owner/repo --non-interactive --json',
    '<%= config.bin %> <%= command.id %> --repo owner/monorepo --base-directory apps/mobile',
  ];

  static override flags = {
    ...EasNonInteractiveAndJsonFlags,
    repo: Flags.string({ description: 'GitHub repository in owner/repo format (github.com)' }),
    'base-directory': Flags.string({
      description:
        'Directory containing the app in the repository (defaults to existing settings or /)',
    }),
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectId,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(IntegrationsGitHubConnect);
    const { json, nonInteractive } = resolveNonInteractiveAndJsonFlags(flags);
    if (json) {
      enableJsonOutput();
    }
    if (nonInteractive && !flags.repo) {
      throw new EasCommandError(
        '--repo is required in non-interactive mode. Use --repo owner/repo.'
      );
    }
    const repo = (
      flags.repo ??
      (
        await promptAsync({
          type: 'text',
          name: 'repo',
          message: 'GitHub repository (owner/repo):',
        })
      ).repo
    ).trim();
    if (!/^[a-zA-Z0-9-]+\/[a-zA-Z0-9_.-]+$/.test(repo)) {
      throw new EasCommandError('Invalid GitHub repository. Use --repo owner/repo.');
    }
    const baseDirectory = flags['base-directory'];
    if (baseDirectory !== undefined && !baseDirectory.trim()) {
      throw new EasCommandError(
        '--base-directory must not be empty. Use / for the repository root.'
      );
    }

    const {
      projectId,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(IntegrationsGitHubConnect, { nonInteractive });

    const spinner = ora('Connecting GitHub repository').start();
    try {
      const app = await GitHubRepositoryQuery.getAppAsync(graphqlClient, projectId);
      if (app.githubRepository) {
        const metadata = app.githubRepository.metadata;
        const linkedRepo = `${metadata.githubRepoOwnerName}/${metadata.githubRepoName}`;
        if (
          linkedRepo.toLowerCase() !== repo.toLowerCase() ||
          new URL(metadata.githubRepoUrl).origin !== 'https://github.com'
        ) {
          throw new EasCommandError(
            `${app.fullName} is already connected to ${linkedRepo}. Disconnect it in the EAS dashboard under Project settings > GitHub before connecting another repository.`
          );
        }
      } else {
        const installations = await GitHubRepositoryQuery.getAccountInstallationsAsync(
          graphqlClient,
          app.ownerAccount.name
        );
        const owner = repo.split('/')[0];
        const installation = installations.find(
          installation =>
            installation.metadata.githubAccountName?.toLowerCase() === owner.toLowerCase() &&
            installation.metadata.installationStatus === GitHubAppInstallationStatus.Active &&
            (!installation.registration ||
              installation.registration.origin === 'https://github.com')
        );
        if (!installation) {
          throw new EasCommandError(
            `No active Expo GitHub app installation for ${owner} is linked to the Expo account ${app.ownerAccount.name}. Install and link the app from ${getExpoWebsiteBaseUrl()}/accounts/${app.ownerAccount.name}/settings before retrying.`
          );
        }
        const repository = await GitHubRepositoryQuery.findRepositoryAsync(
          graphqlClient,
          installation.installationIdentifier,
          repo
        );
        if (!repository) {
          throw new EasCommandError(
            `GitHub repository ${repo} is not accessible. Check that the Expo GitHub app has access to this repository and your GitHub account is authorized in your Expo personal settings.`
          );
        }
        await GitHubRepositoryMutation.createAsync(graphqlClient, {
          appId: projectId,
          githubAppInstallationId: installation.id,
          githubRepositoryIdentifier: repository.id,
          nodeIdentifier: repository.nodeId,
        });
      }

      if (!app.githubRepositorySettings) {
        await GitHubRepositoryMutation.createSettingsAsync(graphqlClient, {
          appId: projectId,
          baseDirectory: baseDirectory ?? '/',
        });
      } else if (
        baseDirectory !== undefined &&
        baseDirectory !== app.githubRepositorySettings.baseDirectory
      ) {
        await GitHubRepositoryMutation.updateSettingsAsync(
          graphqlClient,
          app.githubRepositorySettings.id,
          baseDirectory
        );
      }
      const updatedApp = await GitHubRepositoryQuery.getAppAsync(graphqlClient, projectId);
      spinner.succeed('Connected GitHub repository');
      printGitHubRepository(updatedApp, { json });
    } catch (error) {
      spinner.fail('Failed to connect GitHub repository');
      throw error;
    }
  }
}
