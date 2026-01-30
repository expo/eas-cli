import { ArchiveSource, ArchiveSourceType } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import spawn from '@expo/turtle-spawn';

export async function shallowCloneRepositoryAsync({
  logger,
  archiveSource,
  destinationDirectory,
}: {
  logger: bunyan;
  archiveSource: ArchiveSource & { type: ArchiveSourceType.GIT };
  destinationDirectory: string;
}): Promise<void> {
  const { repositoryUrl } = archiveSource;
  try {
    await spawn('git', ['init'], { cwd: destinationDirectory });
    await spawn('git', ['remote', 'add', 'origin', repositoryUrl], { cwd: destinationDirectory });

    const { gitRef, gitCommitHash } = archiveSource;

    await spawn('git', ['fetch', 'origin', '--depth', '1', '--no-tags', gitCommitHash], {
      cwd: destinationDirectory,
    });

    await spawn('git', ['checkout', gitCommitHash], { cwd: destinationDirectory });

    // If we have a gitRef, we try to add it to the repo.
    if (gitRef) {
      const { name, type } = getStrippedBranchOrTagName(gitRef);
      switch (type) {
        // If the gitRef is for a tag, we add a lightweight tag to current commit.
        case 'tag': {
          await spawn('git', ['tag', name], { cwd: destinationDirectory });
          break;
        }
        // gitRef for a branch may come as:
        // - qualified ref (e.g. refs/heads/feature/add-icon), detected as "branch" for a push,
        // - unqualified ref (e.g. feature/add-icon), detected as "other" for a pull request.
        case 'branch':
        case 'other': {
          await spawn('git', ['checkout', '-b', name], { cwd: destinationDirectory });
          break;
        }
      }
    }
  } catch (err: any) {
    const sanitizedUrl = getSanitizedGitUrl(repositoryUrl);
    if (sanitizedUrl) {
      logger.error(`Failed to clone git repository: ${sanitizedUrl}.`);
    } else {
      logger.error('Failed to clone git repository.');
    }
    logger.error(err.stderr);
    throw err;
  }
}

function getSanitizedGitUrl(maybeGitUrl: string): string | null {
  try {
    const url = new URL(maybeGitUrl);
    if (url.password) {
      url.password = '*******';
    }
    return url.toString();
  } catch {
    return null;
  }
}

function getStrippedBranchOrTagName(ref: string): {
  name: string;
  type: 'branch' | 'tag' | 'other';
} {
  const branchRegex = /(\/?refs)?\/?heads\/(.+)/;
  const branchMatch = ref.match(branchRegex);

  if (branchMatch) {
    return {
      name: branchMatch[2],
      type: 'branch',
    };
  }

  const tagRegex = /(\/?refs)?\/?tags\/(.+)/;
  const tagMatch = ref.match(tagRegex);

  if (tagMatch) {
    return {
      name: tagMatch[2],
      type: 'tag',
    };
  }

  return {
    name: ref,
    type: 'other',
  };
}
