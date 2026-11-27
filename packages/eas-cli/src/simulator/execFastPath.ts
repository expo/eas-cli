import spawnAsync from '@expo/spawn-async';
import chalk from 'chalk';
import fs from 'fs-extra';
import getenv from 'getenv';
import os from 'os';
import path from 'path';
import pkgDir from 'pkg-dir';
import semver from 'semver';

import { isSimulatorCommandId } from './commandAliases';
import { loadSimulatorEnvAsync } from './env';
import { markAsParentCommand } from '../analytics/parentCommand';
import Log from '../log';
import { easCliVersion } from '../utils/easCli';

function hasHelpFlag(args: string[]): boolean {
  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      return true;
    }
    if (arg === '--') {
      return false;
    }
  }
  return false;
}

export function isSimulatorExecFastPathArgv(argv: string[]): boolean {
  return isSimulatorCommandId(argv[0], 'exec') && !hasHelpFlag(argv.slice(1));
}

export function parseSimulatorExecArgv(rawArgv: string[]): { command: string; args: string[] } {
  const commandArgv = rawArgv[0] === '--' ? rawArgv.slice(1) : rawArgv;
  const [command, ...args] = commandArgv;
  if (typeof command !== 'string' || command.length === 0) {
    throw new Error('No command provided. Run `eas simulator:exec <command> [args...]`.');
  }
  return { command, args };
}

function isStrictDescendant(parentDir: string, candidateDir: string): boolean {
  const relative = path.relative(path.resolve(parentDir), path.resolve(candidateDir));
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

async function findNestedGitRootAsync(
  startDir: string,
  projectRootDir: string
): Promise<string | null> {
  const normalizedProjectRoot = path.resolve(projectRootDir);
  let currentDir = path.resolve(startDir);

  while (currentDir !== normalizedProjectRoot) {
    if (await fs.pathExists(path.join(currentDir, '.git'))) {
      return currentDir;
    }
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
  }

  return null;
}

async function readCliVersionConstraintAsync(projectDir: string): Promise<string | undefined> {
  const easJsonPath = path.join(projectDir, 'eas.json');
  let raw: string;
  try {
    raw = await fs.readFile(easJsonPath, 'utf8');
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
      return undefined;
    }
    throw err;
  }

  try {
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      (parsed.cli === undefined ||
        (typeof parsed.cli === 'object' &&
          parsed.cli !== null &&
          !Array.isArray(parsed.cli) &&
          (parsed.cli.version === undefined || typeof parsed.cli.version === 'string')))
    ) {
      return parsed.cli?.version;
    }
  } catch {
    // Fall through to @expo/eas-json for JSON5 comments, trailing commas, or parse errors.
  }

  const { EasJsonAccessor, EasJsonUtils } = await import('@expo/eas-json');
  const config = await EasJsonUtils.getCliConfigAsync(EasJsonAccessor.fromProjectPath(projectDir));
  return config?.version;
}

export async function resolveSimulatorExecProjectDirAsync(cwd?: string): Promise<string> {
  const projectDir = await pkgDir(cwd);
  if (!projectDir) {
    throw new Error('Run this command inside a project directory.');
  }

  const effectiveCwd = cwd ?? process.cwd();
  const hasVcsEnvOverride = Boolean(
    process.env.EAS_NO_VCS || process.env.GIT_DIR || process.env.GIT_WORK_TREE
  );

  if (hasVcsEnvOverride) {
    const { resolveVcsClient } = await import('../vcs');
    let vcsRoot: string | undefined;
    try {
      vcsRoot = path.normalize(await resolveVcsClient().getRootPathAsync());
    } catch {}
    if (vcsRoot && isStrictDescendant(projectDir, vcsRoot)) {
      throw new Error(
        `package.json is outside of the current git repository (project root: ${projectDir}, git root: ${vcsRoot}.`
      );
    }
  } else {
    const nestedGitRoot = await findNestedGitRootAsync(effectiveCwd, projectDir);
    if (nestedGitRoot) {
      throw new Error(
        `package.json is outside of the current git repository (project root: ${projectDir}, git root: ${nestedGitRoot}.`
      );
    }
  }

  const cliVersion = await readCliVersionConstraintAsync(projectDir);
  const shouldSkipVersionCheck = getenv.boolish('EAS_SKIP_CLI_VERSION_CHECK', false);
  if (!shouldSkipVersionCheck && cliVersion && !semver.satisfies(easCliVersion, cliVersion)) {
    throw new Error(
      `You are on eas-cli@${easCliVersion} which does not satisfy the CLI version constraint defined in eas.json (${cliVersion}).\n\nThis error probably means that you need update your eas-cli to a newer version.\nRun ${chalk.bold(
        'npm install -g eas-cli'
      )} to update the eas-cli to the latest version.`
    );
  }

  return projectDir;
}

function getExitCodeForSignal(signal: string): number {
  const signalNumber = (os.constants.signals as Record<string, number | undefined>)[signal];
  return typeof signalNumber === 'number' ? 128 + signalNumber : 1;
}

export async function spawnSimulatorExecCommandAsync(
  command: string,
  args: string[]
): Promise<void> {
  try {
    await spawnAsync(command, args, {
      stdio: 'inherit',
      env: process.env,
    });
  } catch (err: any) {
    if (err?.status == null && err?.signal == null) {
      Log.errorToStderr(err instanceof Error ? err.message : String(err));
      process.exitCode = process.exitCode ?? 1;
    } else if (typeof err?.signal === 'string') {
      process.exitCode = process.exitCode ?? getExitCodeForSignal(err.signal);
    } else {
      process.exitCode = process.exitCode ?? err.status ?? 1;
    }
  }
}

export async function runSimulatorExecFastPathAsync(
  rawArgv: string[],
  { cwd }: { cwd?: string } = {}
): Promise<void> {
  let command: string;
  let args: string[];
  try {
    ({ command, args } = parseSimulatorExecArgv(rawArgv));
    const projectDir = await resolveSimulatorExecProjectDirAsync(cwd);
    await loadSimulatorEnvAsync(projectDir);
  } catch (err: any) {
    Log.errorToStderr(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
    return;
  }

  const { restoreParentCommand } = markAsParentCommand('eas simulator:exec');
  try {
    await spawnSimulatorExecCommandAsync(command, args);
  } finally {
    restoreParentCommand();
  }
}
