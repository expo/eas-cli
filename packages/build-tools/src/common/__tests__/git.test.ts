import { SystemError, UserError } from '@expo/eas-build-job';
import spawn from '@expo/turtle-spawn';
import { vol } from 'memfs';

import { fetchAndCheckoutRefAsync, stripRepositoryCredentialsAsync } from '../git';

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
      ['fetch', 'origin', '--depth', '1', '--no-tags', 'refs/heads/feature/add-icon'],
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

  it('does not qualify a bare name containing "heads/" mid-path', async () => {
    await fetchAndCheckoutRefAsync({
      ref: 'docs/heads/update',
      repositoryDirectory,
    });

    expect(spawn).toHaveBeenNthCalledWith(
      1,
      'git',
      ['fetch', 'origin', '--depth', '1', '--no-tags', 'docs/heads/update'],
      { cwd: repositoryDirectory }
    );
    expect(spawn).toHaveBeenNthCalledWith(
      2,
      'git',
      ['checkout', '-B', 'docs/heads/update', 'FETCH_HEAD'],
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
      ['fetch', 'origin', '--depth', '1', '--no-tags', 'refs/tags/v1.2.3'],
      { cwd: repositoryDirectory }
    );
    expect(spawn).toHaveBeenNthCalledWith(2, 'git', ['checkout', 'FETCH_HEAD'], {
      cwd: repositoryDirectory,
    });
    expect(spawn).toHaveBeenNthCalledWith(3, 'git', ['tag', '--force', 'v1.2.3'], {
      cwd: repositoryDirectory,
    });
  });

  it.each([
    ['SHA-1', '0123456789abcdef0123456789abcdef01234567'],
    ['SHA-256', '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'],
  ])('checks out a bare %s commit hash as detached HEAD', async (_format, sha) => {
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
    expect(spawn).toHaveBeenNthCalledWith(2, 'git', ['checkout', 'FETCH_HEAD'], {
      cwd: repositoryDirectory,
    });
    expect(spawn).toHaveBeenCalledTimes(2);
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

describe(stripRepositoryCredentialsAsync, () => {
  const token = 'ghs_secret123';

  function mockRemoteUrl(url: string): void {
    jest.mocked(spawn).mockResolvedValueOnce({ stdout: `${url}\n` } as never);
  }

  it('strips the token from the origin remote', async () => {
    mockRemoteUrl(`https://x-access-token:${token}@github.com/expo/app.git`);

    await stripRepositoryCredentialsAsync({ repositoryDirectory });

    expect(spawn).toHaveBeenNthCalledWith(1, 'git', ['remote', 'get-url', 'origin'], {
      cwd: repositoryDirectory,
    });
    expect(spawn).toHaveBeenNthCalledWith(
      2,
      'git',
      ['remote', 'set-url', 'origin', 'https://github.com/expo/app.git'],
      { cwd: repositoryDirectory }
    );
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it('keeps the host and port of a GitHub Enterprise remote', async () => {
    mockRemoteUrl(`https://x-access-token:${token}@ghe.example.com:8443/org/app.git`);

    await stripRepositoryCredentialsAsync({ repositoryDirectory });

    expect(spawn).toHaveBeenNthCalledWith(
      2,
      'git',
      ['remote', 'set-url', 'origin', 'https://ghe.example.com:8443/org/app.git'],
      { cwd: repositoryDirectory }
    );
  });

  it('does nothing when the origin remote carries no credentials', async () => {
    mockRemoteUrl('https://github.com/expo/app.git');

    await stripRepositoryCredentialsAsync({ repositoryDirectory });

    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('throws when the remote URL cannot be rewritten', async () => {
    mockRemoteUrl(`https://x-access-token:${token}@github.com/expo/app.git`);
    const gitError = Object.assign(new Error('git exited with non-zero code: 128'), {
      stderr: "fatal: No such remote 'origin'",
    });
    jest.mocked(spawn).mockRejectedValueOnce(gitError);

    const promise = stripRepositoryCredentialsAsync({ repositoryDirectory });

    await expect(promise).rejects.toBeInstanceOf(SystemError);
    await expect(promise).rejects.toMatchObject({ cause: gitError });
    const error = await promise.catch(err => err);
    expect(error.message).not.toContain(token);
  });
});
