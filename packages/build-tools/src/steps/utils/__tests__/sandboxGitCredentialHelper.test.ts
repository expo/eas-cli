import { UserError } from '@expo/eas-build-job';

import { runGitCredentialHelperAsync } from '../sandboxGitCredentialHelper';
import { mintSandboxGitHubTokenAsync } from '../sandboxGitHubToken';

jest.mock('../sandboxGitHubToken');

const mintMock = jest.mocked(mintSandboxGitHubTokenAsync);

const token = 'ghs_minted_token_value';
const env = {
  EXPO_TOKEN: 'robot-token',
  EAS_BUILD_ID: 'job-run-id',
  __API_SERVER_URL: 'https://staging-api.expo.test',
};

beforeEach(() => {
  mintMock.mockResolvedValue(token);
});

async function runAsync({
  argv = ['get'],
  stdin = 'protocol=https\nhost=github.com\n\n',
  env: helperEnv = env,
}: { argv?: string[]; stdin?: string; env?: Record<string, string | undefined> } = {}): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  let stdout = '';
  let stderr = '';
  const exitCode = await runGitCredentialHelperAsync({
    argv,
    stdin,
    env: helperEnv,
    stdout: text => {
      stdout += text;
    },
    stderr: text => {
      stderr += text;
    },
  });
  return { exitCode, stdout, stderr };
}

describe(runGitCredentialHelperAsync, () => {
  it('answers a get request with a freshly minted token', async () => {
    await expect(runAsync()).resolves.toEqual({
      exitCode: 0,
      stdout: `username=x-access-token\npassword=${token}\n\n`,
      stderr: '',
    });
    expect(mintMock).toHaveBeenCalledTimes(1);
    expect(mintMock).toHaveBeenCalledWith({
      expoApiV2BaseUrl: 'https://staging-api.expo.test/v2/',
      robotAccessToken: 'robot-token',
      jobRunId: 'job-run-id',
    });
  });

  it.each(['store', 'erase'])('accepts %s without minting a token', async operation => {
    await expect(runAsync({ argv: [operation], env: {} })).resolves.toEqual({
      exitCode: 0,
      stdout: '',
      stderr: '',
    });
    expect(mintMock).not.toHaveBeenCalled();
  });

  it.each(['EXPO_TOKEN', 'EAS_BUILD_ID', '__API_SERVER_URL'] as const)(
    'fails and names the variable when %s is missing',
    async variable => {
      const { [variable]: _omitted, ...partialEnv } = env;

      await expect(runAsync({ env: partialEnv })).resolves.toEqual({
        exitCode: 1,
        stdout: '',
        stderr: `${variable} is not set, so the sandbox cannot mint GitHub credentials.\n`,
      });
      expect(mintMock).not.toHaveBeenCalled();
    }
  );

  it('treats an empty variable as missing', async () => {
    await expect(runAsync({ env: { ...env, EXPO_TOKEN: '' } })).resolves.toMatchObject({
      exitCode: 1,
      stderr: expect.stringContaining('EXPO_TOKEN is not set'),
    });
    expect(mintMock).not.toHaveBeenCalled();
  });

  it('reports the www message when minting is rejected', async () => {
    mintMock.mockRejectedValue(
      new UserError('EAS_SANDBOX_GITHUB_TOKEN_REJECTED', 'The sandbox has ended.')
    );

    const result = await runAsync();

    expect(result).toEqual({ exitCode: 1, stdout: '', stderr: 'The sandbox has ended.\n' });
    expect(result.stderr).not.toContain(token);
  });

  it('reports a generic message when minting fails for a non-error reason', async () => {
    mintMock.mockRejectedValue(token);

    await expect(runAsync()).resolves.toEqual({
      exitCode: 1,
      stdout: '',
      stderr: 'Could not obtain GitHub credentials for the sandbox.\n',
    });
  });

  it.each([['approve'], []])('rejects the unsupported operation in %j', async (...argv) => {
    await expect(runAsync({ argv })).resolves.toMatchObject({
      exitCode: 1,
      stdout: '',
      stderr: expect.stringContaining('Unsupported git credential operation'),
    });
    expect(mintMock).not.toHaveBeenCalled();
  });
});
