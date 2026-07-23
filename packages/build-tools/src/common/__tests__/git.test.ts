import { UserError } from '@expo/eas-build-job';
import spawn from '@expo/turtle-spawn';
import { vol } from 'memfs';

import { fetchAndCheckoutRefAsync } from '../git';

jest.mock('@expo/turtle-spawn');

const repositoryDirectory = '/repo';

describe(fetchAndCheckoutRefAsync, () => {
  beforeEach(async () => {
    await vol.promises.mkdir(`${repositoryDirectory}/.git`, { recursive: true });
  });

  it('fetches and checks out a qualified branch ref', async () => {
    await fetchAndCheckoutRefAsync({
      ref: 'refs/heads/feature/add-icon',
      repositoryDirectory,
    });

    expect(spawn).toHaveBeenNthCalledWith(
      1,
      'git',
      ['fetch', 'origin', '--depth', '1', '--no-tags', 'feature/add-icon'],
      { cwd: repositoryDirectory }
    );
    expect(spawn).toHaveBeenNthCalledWith(
      2,
      'git',
      ['checkout', '-B', 'feature/add-icon', 'FETCH_HEAD'],
      { cwd: repositoryDirectory }
    );
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it('fetches and checks out a bare branch name', async () => {
    await fetchAndCheckoutRefAsync({
      ref: 'feature/add-icon',
      repositoryDirectory,
    });

    expect(spawn).toHaveBeenNthCalledWith(
      1,
      'git',
      ['fetch', 'origin', '--depth', '1', '--no-tags', 'feature/add-icon'],
      { cwd: repositoryDirectory }
    );
    expect(spawn).toHaveBeenNthCalledWith(
      2,
      'git',
      ['checkout', '-B', 'feature/add-icon', 'FETCH_HEAD'],
      { cwd: repositoryDirectory }
    );
  });

  it('checks out a tag ref and recreates the tag', async () => {
    await fetchAndCheckoutRefAsync({
      ref: 'refs/tags/v1.2.3',
      repositoryDirectory,
    });

    expect(spawn).toHaveBeenNthCalledWith(
      1,
      'git',
      ['fetch', 'origin', '--depth', '1', '--no-tags', 'v1.2.3'],
      { cwd: repositoryDirectory }
    );
    expect(spawn).toHaveBeenNthCalledWith(2, 'git', ['checkout', 'FETCH_HEAD'], {
      cwd: repositoryDirectory,
    });
    expect(spawn).toHaveBeenNthCalledWith(3, 'git', ['tag', '--force', 'v1.2.3'], {
      cwd: repositoryDirectory,
    });
  });

  it('checks out a bare commit SHA', async () => {
    const sha = '0123456789abcdef0123456789abcdef01234567';

    await fetchAndCheckoutRefAsync({
      ref: sha,
      repositoryDirectory,
    });

    expect(spawn).toHaveBeenNthCalledWith(
      1,
      'git',
      ['fetch', 'origin', '--depth', '1', '--no-tags', sha],
      { cwd: repositoryDirectory }
    );
    expect(spawn).toHaveBeenNthCalledWith(2, 'git', ['checkout', '-B', sha, 'FETCH_HEAD'], {
      cwd: repositoryDirectory,
    });
  });

  it('throws when the directory is not a git repository', async () => {
    await vol.promises.mkdir('/not-a-repo', { recursive: true });

    await expect(
      fetchAndCheckoutRefAsync({
        ref: 'main',
        repositoryDirectory: '/not-a-repo',
      })
    ).rejects.toMatchObject({ errorCode: 'EAS_CHECKOUT_NOT_A_GIT_REPOSITORY' });

    expect(spawn).not.toHaveBeenCalled();
  });

  it('wraps git errors in a UserError without relaying git output', async () => {
    const gitError = Object.assign(new Error('git exited with non-zero code: 128'), {
      stderr:
        "fatal: unable to access 'https://x-access-token:ghs_secret123@github.com/expo/app.git/': The requested URL returned error: 403",
    });
    jest.mocked(spawn).mockRejectedValueOnce(gitError);

    const promise = fetchAndCheckoutRefAsync({ ref: 'main', repositoryDirectory });

    await expect(promise).rejects.toBeInstanceOf(UserError);
    await expect(promise).rejects.toMatchObject({
      errorCode: 'EAS_CHECKOUT_FAILED_TO_CHECKOUT_REF',
      cause: gitError,
    });
    const error = await promise.catch(err => err);
    expect(error.message).toContain('Failed to fetch and check out ref "main"');
    expect(error.message).not.toContain('ghs_secret123');
  });
});
