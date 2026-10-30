import { ArchiveSourceType, SystemError, UserError } from '@expo/eas-build-job';
import { type BuildStepContext, type BuildStepEnv } from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import path from 'node:path';

import {
  MissingSandboxGitCredentialsEnvError,
  type SandboxGitHubTokenMintOptions,
  getMintOptionsFromEnv,
} from './sandboxGitCredentialHelper';
import { mintSandboxGitHubTokenAsync } from './sandboxGitHubToken';

const CREDENTIAL_HELPER_MAIN = path.join(__dirname, 'sandboxGitCredentialHelperMain.js');

export async function configureSandboxGitCredentialsAsync({
  stepCtx,
  env,
  signal,
}: {
  stepCtx: BuildStepContext;
  env: BuildStepEnv;
  signal?: AbortSignal;
}): Promise<BuildStepEnv> {
  const { logger, workingDirectory } = stepCtx;
  if (
    stepCtx.global.staticContext.job.projectArchive.type !== ArchiveSourceType.GIT ||
    !stepCtx.global.wasCheckedOut()
  ) {
    logger.debug('The sandbox has no git checkout, so git keeps its current credentials.');
    return env;
  }

  let mintOptions: SandboxGitHubTokenMintOptions;
  try {
    mintOptions = getMintOptionsFromEnv(env);
  } catch (error) {
    if (error instanceof MissingSandboxGitCredentialsEnvError) {
      logger.warn(
        `Git keeps the credentials it was cloned with because ${error.variable} is not available. Pushes may stop working after one hour.`
      );
      return env;
    }
    throw error;
  }

  const originUrl = await parseOriginUrlAsync(workingDirectory, env);
  if (!originUrl) {
    logger.warn(
      'Git keeps the credentials it was cloned with because the origin remote URL could not be read. Pushes may stop working after one hour.'
    );
    return env;
  }

  try {
    await mintSandboxGitHubTokenAsync({ ...mintOptions, signal });
  } catch (error) {
    if (error instanceof UserError || error instanceof SystemError) {
      logger.warn(
        `Git keeps the credentials it was cloned with because a GitHub token could not be minted: ${error.message} Pushes may stop working after one hour.`
      );
      return env;
    }
    throw error;
  }

  const helperKey = `credential.https://${originUrl.host}.helper`;
  originUrl.username = '';
  originUrl.password = '';
  await runGitAsync(workingDirectory, env, ['remote', 'set-url', 'origin', originUrl.toString()]);
  await runGitAsync(workingDirectory, env, ['config', '--global', '--add', helperKey, '']);
  await runGitAsync(workingDirectory, env, [
    'config',
    '--global',
    '--add',
    helperKey,
    `!${shellQuote(process.execPath)} ${shellQuote(CREDENTIAL_HELPER_MAIN)}`,
  ]);

  return { ...env, GIT_TERMINAL_PROMPT: '0' };
}

async function parseOriginUrlAsync(
  workingDirectory: string,
  env: BuildStepEnv
): Promise<URL | null> {
  try {
    const { stdout } = await spawn('git', ['remote', 'get-url', 'origin'], {
      cwd: workingDirectory,
      env,
      stdio: 'pipe',
    });
    return new URL(stdout.trim());
  } catch {
    return null;
  }
}

async function runGitAsync(
  workingDirectory: string,
  env: BuildStepEnv,
  args: string[]
): Promise<void> {
  try {
    await spawn('git', args, { cwd: workingDirectory, env, stdio: 'pipe' });
  } catch {
    throw new SystemError(
      `Failed to configure sandbox git credentials: "git ${args[0]} ${args[1]}" failed.`
    );
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
