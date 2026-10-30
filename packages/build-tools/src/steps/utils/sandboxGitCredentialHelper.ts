import { mintSandboxGitHubTokenAsync } from './sandboxGitHubToken';

export const GIT_CREDENTIAL_USERNAME = 'x-access-token';

export type SandboxGitCredentialHelperEnv = {
  EXPO_TOKEN?: string;
  EAS_BUILD_ID?: string;
  __API_SERVER_URL?: string;
};

export type SandboxGitHubTokenMintOptions = {
  expoApiV2BaseUrl: string;
  robotAccessToken: string;
  jobRunId: string;
};

export async function runGitCredentialHelperAsync({
  argv,
  stdin,
  env,
  stdout,
  stderr,
}: {
  argv: string[];
  stdin: string;
  env: SandboxGitCredentialHelperEnv;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}): Promise<number> {
  try {
    const operation = argv.at(-1);
    switch (operation) {
      case 'store':
      case 'erase':
        return 0;
      case 'get':
        break;
      default:
        stderr(`Unsupported git credential operation: ${operation ?? '(none)'}\n`);
        return 1;
    }
    const token = await mintSandboxGitHubTokenAsync(getMintOptionsFromEnv(env));
    stdout(`username=${GIT_CREDENTIAL_USERNAME}\npassword=${token}\n\n`);
    return 0;
  } catch (error) {
    stderr(`${describeError(error)}\n`);
    return 1;
  }
}

export function getMintOptionsFromEnv(
  env: SandboxGitCredentialHelperEnv
): SandboxGitHubTokenMintOptions {
  const robotAccessToken = requireEnv(env, 'EXPO_TOKEN');
  const jobRunId = requireEnv(env, 'EAS_BUILD_ID');
  const apiServerUrl = requireEnv(env, '__API_SERVER_URL');
  return {
    expoApiV2BaseUrl: new URL('/v2/', apiServerUrl).toString(),
    robotAccessToken,
    jobRunId,
  };
}

export class MissingSandboxGitCredentialsEnvError extends Error {
  constructor(public readonly variable: keyof SandboxGitCredentialHelperEnv) {
    super(`${variable} is not set, so the sandbox cannot mint GitHub credentials.`);
  }
}

function requireEnv(
  env: SandboxGitCredentialHelperEnv,
  variable: keyof SandboxGitCredentialHelperEnv
): string {
  const value = env[variable];
  if (!value) {
    throw new MissingSandboxGitCredentialsEnvError(variable);
  }
  return value;
}

function describeError(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Could not obtain GitHub credentials for the sandbox.';
}
