import { GitHubRepositoryAppQuery } from '../graphql/generated';
import Log from '../log';
import { printJsonOnlyOutput } from '../utils/json';

export function printGitHubRepository(
  app: GitHubRepositoryAppQuery['app']['byId'],
  { json }: { json: boolean }
): void {
  const repository = app.githubRepository;
  const fullName = repository
    ? `${repository.metadata.githubRepoOwnerName}/${repository.metadata.githubRepoName}`
    : null;
  if (json) {
    printJsonOnlyOutput({
      projectId: app.id,
      projectFullName: app.fullName,
      connected: !!repository,
      repository: repository
        ? {
            id: repository.id,
            fullName,
            url: repository.metadata.githubRepoUrl,
            githubRepositoryIdentifier: repository.githubRepositoryIdentifier,
          }
        : null,
      baseDirectory: app.githubRepositorySettings?.baseDirectory ?? null,
    });
  } else if (repository) {
    Log.log(`${app.fullName} is connected to ${fullName}.`);
    Log.log(`Base directory: ${app.githubRepositorySettings?.baseDirectory ?? '(not configured)'}`);
  } else {
    Log.log(`${app.fullName} is not connected to a GitHub repository.`);
  }
}
