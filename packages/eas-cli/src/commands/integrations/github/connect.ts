import { Flags } from '@oclif/core';

import { getExpoWebsiteBaseUrl } from '../../../api';
import { getProjectGitHubSettingsUrl } from '../../../build/utils/url';
import EasCommand from '../../../commandUtils/EasCommand';
import { EasCommandError } from '../../../commandUtils/errors';
import {
  EasNonInteractiveAndJsonFlags,
  resolveNonInteractiveAndJsonFlags,
} from '../../../commandUtils/flags';
import { printGitHubRepository } from '../../../commandUtils/github';
import { GraphqlError } from '../../../graphql/client';
import {
  GitHubAppInstallationAccountType,
  GitHubAppInstallationStatus,
} from '../../../graphql/generated';
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
      const projectGitHubSettingsUrl = getProjectGitHubSettingsUrl(app.ownerAccount.name, app.slug);
      if (app.githubRepository) {
        const metadata = app.githubRepository.metadata;
        const linkedRepo = `${metadata.githubRepoOwnerName}/${metadata.githubRepoName}`;
        if (
          linkedRepo.toLowerCase() !== repo.toLowerCase() ||
          new URL(metadata.githubRepoUrl).origin !== 'https://github.com'
        ) {
          throw new EasCommandError(
            `${app.fullName} is already connected to ${linkedRepo}. Disconnect it in the EAS dashboard before connecting another repository: ${projectGitHubSettingsUrl}`
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
            `No active Expo GitHub app installation for ${owner} is linked to the Expo account ${app.ownerAccount.name}. Set up the GitHub connection in the EAS dashboard: ${projectGitHubSettingsUrl}\nInstall the Expo GitHub app for ${owner} and link the installation to ${app.ownerAccount.name}, then retry this command.`
          );
        }
        const repository = await GitHubRepositoryQuery.findRepositoryAsync(
          graphqlClient,
          installation.installationIdentifier,
          repo
        );
        if (!repository) {
          const organizationPath =
            installation.metadata.githubAccountType ===
            GitHubAppInstallationAccountType.Organization
              ? `/organizations/${encodeURIComponent(owner)}`
              : '';
          const installationSettingsUrl = `https://github.com${organizationPath}/settings/installations/${installation.installationIdentifier}`;
          throw new EasCommandError(
            `EAS cannot access GitHub repository ${repo}. If the Expo GitHub app is configured for "Only select repositories", add ${repo} under Repository access and save: ${installationSettingsUrl}\nYou may need a GitHub account or organization admin to grant access. Also check the repository name and that your GitHub user has access to it, then retry this command.`
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
      if (error instanceof GraphqlError && !error.networkError) {
        const authorizationError = error.graphQLErrors.find(
          error =>
            error.extensions.errorCode === 'GITHUB_USER_NOT_FOUND_ERROR' ||
            error.extensions.errorCode === 'GITHUB_AUTHENTICATION_ERROR'
        );
        if (authorizationError) {
          const reason =
            authorizationError.extensions.errorCode === 'GITHUB_USER_NOT_FOUND_ERROR'
              ? 'Your Expo user account is not connected to GitHub.'
              : 'Your GitHub authorization is no longer valid.';
          throw new EasCommandError(
            `${reason} Connect or reconnect GitHub under Connections in your Expo personal settings: ${getExpoWebsiteBaseUrl()}/settings\nThen retry this command.`
          );
        }
      }
      throw error;
    }
  }
}
