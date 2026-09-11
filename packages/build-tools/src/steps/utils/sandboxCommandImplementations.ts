import {
  type SandboxDaemonCommandParams,
  type SandboxDaemonCommandResult,
  type SandboxDaemonMethod,
} from '@expo/eas-build-job';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { constants as osConstants } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const DEFAULT_EXEC_YIELD_TIME_MS = 10_000;
const DEFAULT_WRITE_YIELD_TIME_MS = 250;
const PROCESS_STOP_GRACE_PERIOD_MS = 1_000;

export type SandboxDaemonCommandImplementations = {
  [Method in SandboxDaemonMethod]: (
    params: SandboxDaemonCommandParams<Method>
  ) => Promise<SandboxDaemonCommandResult<Method>>;
};

export function createSandboxDaemonCommandImplementations(workingDirectory: string): {
  commandImplementations: SandboxDaemonCommandImplementations;
  stopAsync: () => Promise<void>;
} {
  const sessions = new Map<number, CommandSession>();
  const processTrees = new Set<ProcessTree>();
  let nextSessionId = 1;
  const commandImplementations = {
    async execCommand(params) {
      const callStartedAt = performance.now();
      const commandWorkingDirectory = params.workdir
        ? path.resolve(workingDirectory, params.workdir)
        : workingDirectory;
      await validateWorkingDirectoryAsync(commandWorkingDirectory);

      const sessionId = nextSessionId++;
      const session = params.tty
        ? startPtyCommand(params.cmd, commandWorkingDirectory, processTrees)
        : startPipeCommand(params.cmd, commandWorkingDirectory, processTrees);
      sessions.set(sessionId, session);

      return await readSessionAsync(
        sessions,
        sessionId,
        session,
        params.yieldTimeMs ?? DEFAULT_EXEC_YIELD_TIME_MS,
        callStartedAt
      );
    },
    async writeStdin(params) {
      const callStartedAt = performance.now();
      const session = sessions.get(params.sessionId);
      if (!session) {
        throw new Error(`Command session ${params.sessionId} does not exist.`);
      }
      if (params.chars !== undefined && !session.isCompleted && !session.error) {
        session.write(params.chars);
      }

      return await readSessionAsync(
        sessions,
        params.sessionId,
        session,
        params.yieldTimeMs ?? DEFAULT_WRITE_YIELD_TIME_MS,
        callStartedAt
      );
    },
  } satisfies SandboxDaemonCommandImplementations;

  return {
    commandImplementations,
    async stopAsync(): Promise<void> {
      const activeProcessTrees = [...processTrees];
      const activeSessions = [...sessions.values()];
      for (const processTree of activeProcessTrees) {
        terminateProcessTree(processTree, 'SIGTERM');
      }
      await waitForSessionsAsync(activeSessions, PROCESS_STOP_GRACE_PERIOD_MS);
      for (const processTree of activeProcessTrees) {
        terminateProcessTree(processTree, 'SIGKILL');
      }
      await waitForSessionsAsync(activeSessions, PROCESS_STOP_GRACE_PERIOD_MS);
      sessions.clear();
      processTrees.clear();
    },
  };
}

interface CommandSession {
  completed: Promise<void>;
  resolveCompleted: () => void;
  isCompleted: boolean;
  output: string;
  outputOffset: number;
  exitCode?: number;
  terminationSignal?: string;
  error?: Error;
  write(chars: string): void;
}

interface ProcessTree {
  pid: number;
  terminateDirectly?: (signal: NodeJS.Signals) => void;
}

function startPipeCommand(
  command: string,
  workingDirectory: string,
  processTrees: Set<ProcessTree>
): CommandSession {
  const child = spawn(command, {
    cwd: workingDirectory,
    env: process.env,
    shell: process.env.SHELL ?? true,
    detached: process.platform !== 'win32',
  });
  const session = createSession();
  if (child.pid !== undefined) {
    processTrees.add({
      pid: child.pid,
      terminateDirectly: process.platform === 'win32' ? signal => child.kill(signal) : undefined,
    });
  }
  session.write = (chars: string): void => {
    child.stdin.write(chars);
  };
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', data => {
    session.output += data;
  });
  child.stderr.on('data', data => {
    session.output += data;
  });
  child.stdin.on('error', () => {});
  child.once('error', error => {
    completeSession(session, { error });
  });
  child.once('close', (exitCode, signal) => {
    completeSession(session, signal ? { terminationSignal: signal } : { exitCode: exitCode ?? 1 });
  });
  return session;
}

function startPtyCommand(
  command: string,
  workingDirectory: string,
  processTrees: Set<ProcessTree>
): CommandSession {
  // Load the native dependency only when a command needs a PTY. A native module problem must not
  // prevent the worker from starting or affect commands that use regular pipes.
  const pty: typeof import('node-pty') = require('node-pty');
  const shell = process.env.SHELL ?? '/bin/sh';
  const terminal = pty.spawn(shell, ['-c', command], {
    cwd: workingDirectory,
    env: process.env,
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
  });
  const session = createSession();
  processTrees.add({
    pid: terminal.pid,
    terminateDirectly: process.platform === 'win32' ? signal => terminal.kill(signal) : undefined,
  });
  session.write = (chars: string): void => {
    terminal.write(chars);
  };
  terminal.onData(data => {
    session.output += data;
  });
  terminal.onExit(({ exitCode, signal }) => {
    completeSession(session, signal ? { terminationSignal: signalName(signal) } : { exitCode });
  });
  return session;
}

async function readSessionAsync(
  sessions: Map<number, CommandSession>,
  sessionId: number,
  session: CommandSession,
  yieldTimeMs: number,
  callStartedAt: number
): Promise<SandboxDaemonCommandResult<SandboxDaemonMethod>> {
  await waitForSessionAsync(session, yieldTimeMs);
  if (session.error) {
    sessions.delete(sessionId);
    throw session.error;
  }

  const output = session.output.slice(session.outputOffset);
  session.outputOffset = session.output.length;
  const result = {
    output,
    wallTimeSeconds: (performance.now() - callStartedAt) / 1_000,
  };
  if (session.terminationSignal !== undefined) {
    sessions.delete(sessionId);
    return { ...result, terminationSignal: session.terminationSignal };
  }
  if (session.exitCode !== undefined) {
    sessions.delete(sessionId);
    return { ...result, exitCode: session.exitCode };
  }
  return { ...result, sessionId };
}

function createSession(): CommandSession {
  let resolveCompleted!: () => void;
  const completed = new Promise<void>(resolve => {
    resolveCompleted = resolve;
  });
  return {
    completed,
    resolveCompleted,
    isCompleted: false,
    output: '',
    outputOffset: 0,
    write: () => {},
  };
}

function completeSession(
  session: CommandSession,
  result: { exitCode: number } | { terminationSignal: string } | { error: Error }
): void {
  if (session.isCompleted) {
    return;
  }
  session.isCompleted = true;
  if ('exitCode' in result) {
    session.exitCode = result.exitCode;
  } else if ('terminationSignal' in result) {
    session.terminationSignal = result.terminationSignal;
  } else {
    session.error = result.error;
  }
  session.resolveCompleted();
}

async function validateWorkingDirectoryAsync(workingDirectory: string): Promise<void> {
  let stats;
  try {
    stats = await fs.stat(workingDirectory);
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      throw new Error(`Working directory does not exist: ${workingDirectory}`);
    }
    if (error?.code === 'EACCES') {
      throw new Error(`Working directory is not accessible: ${workingDirectory}`);
    }
    throw error;
  }
  if (!stats.isDirectory()) {
    throw new Error(`Working directory is not a directory: ${workingDirectory}`);
  }
  try {
    await fs.access(workingDirectory, fs.constants.R_OK | fs.constants.X_OK);
  } catch (error: any) {
    if (error?.code === 'EACCES') {
      throw new Error(`Working directory is not accessible: ${workingDirectory}`);
    }
    throw error;
  }
}

function terminateProcessTree(processTree: ProcessTree, signal: NodeJS.Signals): void {
  if (process.platform !== 'win32') {
    try {
      process.kill(-processTree.pid, signal);
      return;
    } catch (error: any) {
      if (error?.code === 'ESRCH') {
        return;
      }
    }
  }
  try {
    processTree.terminateDirectly?.(signal);
  } catch (error: any) {
    if (error?.code !== 'ESRCH') {
      throw error;
    }
  }
}

function signalName(signal: number): string {
  return (
    Object.entries(osConstants.signals).find(([, signalNumber]) => signalNumber === signal)?.[0] ??
    `SIGNAL_${signal}`
  );
}

async function waitForSessionsAsync(sessions: CommandSession[], timeoutMs: number): Promise<void> {
  await new Promise<void>(resolve => {
    const timer = setTimeout(resolve, timeoutMs);
    void Promise.all(sessions.map(session => session.completed)).then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function waitForSessionAsync(session: CommandSession, timeoutMs: number): Promise<void> {
  await new Promise<void>(resolve => {
    const timer = setTimeout(resolve, timeoutMs);
    void session.completed.then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}
