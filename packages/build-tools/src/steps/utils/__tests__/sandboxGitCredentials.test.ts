import { ArchiveSourceType, SystemError, UserError } from '@expo/eas-build-job';
import spawn from '@expo/turtle-spawn';
import path from 'node:path';

import { configureSandboxGitCredentialsAsync } from '../sandboxGitCredentials';
import { mintSandboxGitHubTokenAsync } from '../sandboxGitHubToken';

jest.mock('@expo/turtle-spawn');
jest.mock('../sandboxGitHubToken');

const spawnMock = jest.mocked(spawn);
const mintMock = jest.mocked(mintSandboxGitHubTokenAsync);

const token = 'ghs_clone_token_value';
const cloneUrl = `https://x-access-token:${token}@github.com/expo/example.git`;
const workingDirectory = '/work/project';
const env = {
  EXPO_TOKEN: 'robot-token',
  EAS_BUILD_ID: 'job-run-id',
  __API_SERVER_URL: 'https://staging-api.expo.test',
  PATH: '/usr/bin',
  HOME: '/home/sandbox',
};

function createStepContext({ archiveType = ArchiveSourceType.GIT, wasCheckedOut = true } = {}): {
  stepCtx: any;
  logger: Record<string, jest.Mock>;
} {
  const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn() };
  return {
    stepCtx: {
      logger,
      workingDirectory,
      global: {
        staticContext: { job: { projectArchive: { type: archiveType } } },
        wasCheckedOut: () => wasCheckedOut,
      },
    },
    logger,
  };
}

function mockGit(originUrl: string = cloneUrl): void {
  spawnMock.mockImplementation((_command, args) => {
    const stdout = args[1] === 'get-url' ? `${originUrl}\n` : '';
    return Promise.resolve({ stdout, stderr: '', status: 0, signal: null, output: [] }) as any;
  });
}

function gitCalls(): string[][] {
  return spawnMock.mock.calls.map(([command, args]) => [command, ...args]);
}

describe(configureSandboxGitCredentialsAsync, () => {
  beforeEach(() => {
    mintMock.mockResolvedValue('probe-token');
    mockGit();
  });

  it.each([
    ['the project archive is not a git repository', { archiveType: ArchiveSourceType.GCS }],
    ['the project is not checked out', { wasCheckedOut: false }],
  ])('leaves git alone when %s', async (_label, overrides) => {
    const { stepCtx, logger } = createStepContext(overrides);

    await expect(configureSandboxGitCredentialsAsync({ stepCtx, env })).resolves.toBe(env);

    expect(spawnMock).not.toHaveBeenCalled();
    expect(mintMock).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it.each(['EXPO_TOKEN', 'EAS_BUILD_ID', '__API_SERVER_URL'] as const)(
    'warns and leaves git alone when %s is missing',
    async missing => {
      const { [missing]: _omitted, ...stepEnv } = env;
      const { stepCtx, logger } = createStepContext();

      await expect(
        configureSandboxGitCredentialsAsync({ stepCtx, env: stepEnv })
      ).resolves.toBe(stepEnv);

      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn.mock.calls[0][0]).toContain(`${missing} is not available`);
      expect(spawnMock).not.toHaveBeenCalled();
      expect(mintMock).not.toHaveBeenCalled();
    }
  );

  it('warns and leaves git alone when the origin URL cannot be read', async () => {
    spawnMock.mockRejectedValue(new Error('fatal: No such remote'));
    const { stepCtx, logger } = createStepContext();

    await expect(configureSandboxGitCredentialsAsync({ stepCtx, env })).resolves.toBe(env);

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(gitCalls()).toEqual([['git', 'remote', 'get-url', 'origin']]);
    expect(mintMock).not.toHaveBeenCalled();
  });

  it.each([
    new UserError('EAS_SANDBOX_GITHUB_TOKEN_REJECTED', 'The sandbox has ended.'),
    new SystemError('The Expo API failed 3 times in a row.'),
  ])('warns with the probe error and leaves git alone: $message', async error => {
    mintMock.mockRejectedValue(error);
    const { stepCtx, logger } = createStepContext();

    await expect(configureSandboxGitCredentialsAsync({ stepCtx, env })).resolves.toBe(env);

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0][0]).toContain(error.message);
    expect(gitCalls()).toEqual([['git', 'remote', 'get-url', 'origin']]);
  });

  it('rethrows unexpected probe errors', async () => {
    const abortError = new DOMException('aborted', 'AbortError');
    mintMock.mockRejectedValue(abortError);
    const { stepCtx } = createStepContext();

    await expect(configureSandboxGitCredentialsAsync({ stepCtx, env })).rejects.toBe(abortError);
  });

  it('points git at the credential helper and strips the clone token', async () => {
    const { stepCtx, logger } = createStepContext();
    const signal = new AbortController().signal;

    const result = await configureSandboxGitCredentialsAsync({ stepCtx, env, signal });

    expect(mintMock).toHaveBeenCalledWith({
      expoApiV2BaseUrl: 'https://staging-api.expo.test/v2/',
      robotAccessToken: 'robot-token',
      jobRunId: 'job-run-id',
      signal,
    });

    const calls = gitCalls();
    expect(calls).toHaveLength(4);
    expect(calls[0]).toEqual(['git', 'remote', 'get-url', 'origin']);
    expect(calls[1]).toEqual([
      'git',
      'remote',
      'set-url',
      'origin',
      'https://github.com/expo/example.git',
    ]);
    expect(calls[2]).toEqual([
      'git',
      'config',
      '--global',
      '--add',
      'credential.https://github.com.helper',
      '',
    ]);
    expect(calls[3].slice(0, 5)).toEqual([
      'git',
      'config',
      '--global',
      '--add',
      'credential.https://github.com.helper',
    ]);
    const helper = calls[3][5];
    expect(helper.startsWith(`!'${process.execPath}' '`)).toBe(true);
    expect(helper.endsWith(`${path.sep}sandboxGitCredentialHelperMain.js'`)).toBe(true);
    expect(helper).not.toContain('--config');
    expect(helper).not.toContain('robot-token');
    for (const call of spawnMock.mock.calls) {
      expect(call[2]).toMatchObject({ cwd: workingDirectory, env, stdio: 'pipe' });
      expect(call[2]).not.toHaveProperty('logger');
    }

    expect(result).toEqual({ ...env, GIT_TERMINAL_PROMPT: '0' });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it.each([
    ['https://x-access-token:t@github.example.com/org/repo.git', 'github.example.com'],
    ['https://x-access-token:t@ghe.example.com:8443/org/repo.git', 'ghe.example.com:8443'],
  ])('scopes the helper of %s to %s', async (originUrl, repositoryHost) => {
    mockGit(originUrl);
    const { stepCtx } = createStepContext();

    await configureSandboxGitCredentialsAsync({ stepCtx, env });

    const calls = gitCalls();
    expect(calls[1][4]).toBe(originUrl.replace('x-access-token:t@', ''));
    expect(calls[2][4]).toBe(`credential.https://${repositoryHost}.helper`);
    expect(calls[3][4]).toBe(`credential.https://${repositoryHost}.helper`);
  });

  it('fails the step without leaking the clone token when a git mutation fails', async () => {
    spawnMock.mockImplementation((_command, args) => {
      if (args[1] === 'get-url') {
        return Promise.resolve({ stdout: `${cloneUrl}\n` }) as any;
      }
      return Promise.reject(new Error(`fatal: ${cloneUrl}`)) as any;
    });
    const { stepCtx } = createStepContext();

    const pending = configureSandboxGitCredentialsAsync({ stepCtx, env });

    await expect(pending).rejects.toBeInstanceOf(SystemError);
    await expect(pending).rejects.toThrow('"git remote set-url" failed.');
    const error = await pending.catch(e => e);
    expect(error.message).not.toContain(token);
    expect(error.cause).toBeUndefined();
  });
});
