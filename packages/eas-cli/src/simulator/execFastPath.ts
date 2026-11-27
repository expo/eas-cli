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

const FORWARDED_SIGNALS: NodeJS.Signals[] =
  process.platform === 'win32' ? ['SIGINT', 'SIGTERM'] : ['SIGINT', 'SIGTERM', 'SIGHUP'];

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
    if (parsed && typeof parsed === 'object' && typeof parsed.cli?.version === 'string') {
      return parsed.cli.version;
    }
    return undefined;
  } catch {
    // Fall back to @expo/eas-json for JSON5 comments, trailing commas, or schema diagnostics.
    const { EasJsonAccessor, EasJsonUtils } = await import('@expo/eas-json');
    const config = await EasJsonUtils.getCliConfigAsync(
      EasJsonAccessor.fromProjectPath(projectDir)
    );
    return config?.version;
  }
}

export async function resolveSimulatorExecProjectDirAsync(cwd?: string): Promise<string> {
  const projectDir = await pkgDir(cwd);
  if (!projectDir) {
    throw new Error('Run this command inside a project directory.');
  }

  const effectiveCwd = cwd ?? process.cwd();
  const hasAbsoluteNoVcsRoot =
    Boolean(process.env.EAS_NO_VCS) &&
    Boolean(process.env.EAS_PROJECT_ROOT) &&
    path.isAbsolute(process.env.EAS_PROJECT_ROOT!);

  if (hasAbsoluteNoVcsRoot) {
    const vcsRoot = path.normalize(process.env.EAS_PROJECT_ROOT!);
    const relativeToProject = path.relative(projectDir, vcsRoot);
    if (
      relativeToProject !== '' &&
      !relativeToProject.startsWith('..') &&
      !path.isAbsolute(relativeToProject)
    ) {
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

  const shouldSkipVersionCheck = getenv.boolish('EAS_SKIP_CLI_VERSION_CHECK', false);
  if (!shouldSkipVersionCheck) {
    const cliVersion = await readCliVersionConstraintAsync(projectDir);
    if (cliVersion && !semver.satisfies(easCliVersion, cliVersion)) {
      throw new Error(
        `You are on eas-cli@${easCliVersion} which does not satisfy the CLI version constraint defined in eas.json (${cliVersion}).\n\nThis error probably means that you need update your eas-cli to a newer version.\nRun ${chalk.bold(
          'npm install -g eas-cli'
        )} to update the eas-cli to the latest version.`
      );
    }
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
  const childPromise = spawnAsync(command, args, {
    stdio: 'inherit',
    env: process.env,
  });

  const signalHandlers = new Map<NodeJS.Signals, () => void>();
  for (const signal of FORWARDED_SIGNALS) {
    const handler = (): void => {
      try {
        childPromise.child?.kill(signal);
      } catch {}
    };
    signalHandlers.set(signal, handler);
    process.on(signal, handler);
  }

  try {
    await childPromise;
  } catch (err: any) {
    if (err?.status == null && err?.signal == null) {
      Log.errorToStderr(err instanceof Error ? err.message : String(err));
      process.exitCode = process.exitCode ?? 1;
    } else if (typeof err?.signal === 'string') {
      process.exitCode = process.exitCode ?? getExitCodeForSignal(err.signal);
    } else {
      process.exitCode = process.exitCode ?? err.status ?? 1;
    }
  } finally {
    for (const [signal, handler] of signalHandlers) {
      process.off(signal, handler);
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
