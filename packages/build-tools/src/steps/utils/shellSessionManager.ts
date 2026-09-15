import * as pty from 'node-pty';
import { type ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { constants as osConstants } from 'node:os';
import path from 'node:path';

import { killProcessGroup } from '../../utils/processes';

const PROCESS_STOP_GRACE_PERIOD_MS = 1_000;
const SIGNAL_NAMES = new Map(
  Object.entries(osConstants.signals)
    .reverse()
    .map(([name, number]) => [number, name])
);

export class ShellSessionManager {
  // Keep completed sessions so callers can still read their output and exit status.
  private readonly sessions = new Map<number, CommandSession>();
  private nextSessionId = 1;
  public readonly stoppedPromise: Promise<void>;

  public constructor(
    private readonly options: {
      workingDirectory: string;
      env: NodeJS.ProcessEnv;
      signal: AbortSignal;
    }
  ) {
    this.stoppedPromise = (async () => {
      if (!options.signal.aborted) {
        await new Promise<void>(resolve => {
          options.signal.addEventListener('abort', () => resolve(), { once: true });
        });
      }
      await this.stopAsync();
    })();
    // Cleanup can fail before the owner awaits it.
    this.stoppedPromise.catch(() => {});
  }

  public async startAsync({
    cmd,
    workdir,
    tty,
  }: {
    cmd: string;
    workdir?: string;
    tty?: boolean;
  }): Promise<number> {
    this.throwIfStopped();
    const workingDirectory = workdir
      ? path.resolve(this.options.workingDirectory, workdir)
      : this.options.workingDirectory;
    await validateWorkingDirectoryAsync(workingDirectory);
    this.throwIfStopped();
    const sessionId = this.nextSessionId++;
    const session = tty
      ? startPtyCommand({ command: cmd, workingDirectory, env: this.options.env })
      : startPipeCommand({ command: cmd, workingDirectory, env: this.options.env });
    this.sessions.set(sessionId, session);
    return sessionId;
  }

  public write(sessionId: number, chars: string): void {
    this.throwIfStopped();
    const session = this.getSession(sessionId);
    if (!session.isCompleted && !session.error) {
      session.write(chars);
    }
  }

  public async readAsync(
    sessionId: number,
    yieldTimeMs: number
  ): Promise<
    { output: string } & (
      | { exitCode: number }
      | { terminationSignal: string }
      | { sessionId: number }
    )
  > {
    this.throwIfStopped();
    const session = this.getSession(sessionId);
    await waitForSessionsAsync([session], yieldTimeMs);
    if (session.error) {
      throw session.error;
    }

    const output = session.output;
    session.output = '';
    const result = {
      output,
    };
    if (session.terminationSignal !== undefined) {
      return { ...result, terminationSignal: session.terminationSignal };
    }
    if (session.exitCode !== undefined) {
      return { ...result, exitCode: session.exitCode };
    }
    return { ...result, sessionId };
  }

  private async stopAsync(): Promise<void> {
    const sessions = [...this.sessions.values()];
    // Only signal groups while their leaders are alive. After a leader exits, its PID may
    // be reused. Any surviving descendants are left to VM teardown.
    for (const session of sessions) {
      if (!session.hasLeaderExited) {
        killProcessGroup(session.process, 'SIGTERM');
      }
    }
    await waitForSessionsAsync(sessions, PROCESS_STOP_GRACE_PERIOD_MS);
    for (const session of sessions) {
      if (!session.hasLeaderExited) {
        killProcessGroup(session.process, 'SIGKILL');
      }
    }
    await waitForSessionsAsync(sessions, PROCESS_STOP_GRACE_PERIOD_MS);
    this.sessions.clear();
  }

  private throwIfStopped(): void {
    this.options.signal.throwIfAborted();
  }

  private getSession(sessionId: number): CommandSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Command session ${sessionId} does not exist.`);
    }
    return session;
  }
}

type CommandSession = {
  process: ChildProcess | pty.IPty;
  completed: Promise<void>;
  resolveCompleted: () => void;
  isCompleted: boolean;
  hasLeaderExited: boolean;
  // Unread output is intentionally unlimited for now and can exhaust memory. Reading clears it.
  output: string;
  exitCode?: number;
  terminationSignal?: string;
  error?: Error;
  write(chars: string): void;
};

function startPipeCommand({
  command,
  workingDirectory,
  env,
}: {
  command: string;
  workingDirectory: string;
  env: NodeJS.ProcessEnv;
}): CommandSession {
  const child = spawn(command, {
    cwd: workingDirectory,
    env,
    shell: env.SHELL ?? true,
    detached: true,
  });
  const session = createSession(child);
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
  child.once('exit', () => {
    session.hasLeaderExited = true;
  });
  child.once('error', error => {
    if (!session.isCompleted) {
      session.hasLeaderExited = true;
      session.isCompleted = true;
      session.error = error;
      session.resolveCompleted();
    }
  });
  child.once('close', (exitCode, signal) => {
    if (!session.isCompleted) {
      session.isCompleted = true;
      if (signal) {
        session.terminationSignal = signal;
      } else {
        session.exitCode = exitCode ?? 1;
      }
      session.resolveCompleted();
    }
  });
  return session;
}

function startPtyCommand({
  command,
  workingDirectory,
  env,
}: {
  command: string;
  workingDirectory: string;
  env: NodeJS.ProcessEnv;
}): CommandSession {
  const shell = env.SHELL ?? '/bin/sh';
  const terminal = pty.spawn(shell, ['-c', command], {
    cwd: workingDirectory,
    env,
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
  });
  const session = createSession(terminal);
  session.write = (chars: string): void => {
    terminal.write(chars);
  };
  terminal.onData(data => {
    session.output += data;
  });
  terminal.onExit(({ exitCode, signal }) => {
    session.hasLeaderExited = true;
    session.isCompleted = true;
    if (signal) {
      session.terminationSignal = SIGNAL_NAMES.get(signal) ?? `SIGNAL_${signal}`;
    } else {
      session.exitCode = exitCode;
    }
    session.resolveCompleted();
  });
  return session;
}

function createSession(process: CommandSession['process']): CommandSession {
  let resolveCompleted!: () => void;
  const completed = new Promise<void>(resolve => {
    resolveCompleted = resolve;
  });
  return {
    process,
    completed,
    resolveCompleted,
    isCompleted: false,
    hasLeaderExited: false,
    output: '',
    write: () => {},
  };
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

async function waitForSessionsAsync(sessions: CommandSession[], timeoutMs: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      Promise.all(sessions.map(session => session.completed)),
      new Promise<void>(resolve => {
        timer = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
