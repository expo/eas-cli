import spawnAsync from '@expo/spawn-async';
import pkgDir from 'pkg-dir';

import { isSimulatorCommandId } from './commandAliases';
import { loadSimulatorEnvAsync } from './env';
import Log from '../log';

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

export async function runSimulatorExecFastPathAsync(
  rawArgv: string[],
  { cwd }: { cwd?: string } = {}
): Promise<void> {
  const [command, ...args] = rawArgv;
  if (typeof command !== 'string' || command.length === 0) {
    Log.errorToStderr('No command provided. Run `eas simulator:exec <command> [args...]`.');
    process.exitCode = 1;
    return;
  }

  let projectDir: string | undefined;
  try {
    projectDir = await pkgDir(cwd);
    if (!projectDir) {
      throw new Error('Run this command inside a project directory.');
    }
    await loadSimulatorEnvAsync(projectDir);
  } catch (err: any) {
    Log.errorToStderr(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
    return;
  }

  try {
    await spawnAsync(command, args, {
      stdio: 'inherit',
      env: process.env,
    });
  } catch (err: any) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
      Log.errorToStderr(err instanceof Error ? err.message : String(err));
    }
    process.exitCode = process.exitCode ?? err?.status ?? 1;
  }
}
