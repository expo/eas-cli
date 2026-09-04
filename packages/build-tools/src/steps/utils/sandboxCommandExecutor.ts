import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import path from 'node:path';
import { z } from 'zod';

const DEFAULT_EXEC_YIELD_TIME_MS = 10_000;
const DEFAULT_WRITE_YIELD_TIME_MS = 250;
const MAX_YIELD_TIME_MS = 30_000;

const execCommandParamsSchema = z.object({
  cmd: z.string().min(1),
  workdir: z.string().optional(),
  yield_time_ms: z.number().int().min(0).max(MAX_YIELD_TIME_MS).optional(),
});

const writeStdinParamsSchema = z.object({
  session_id: z.number().int().positive(),
  chars: z.string().optional(),
  yield_time_ms: z.number().int().min(0).max(MAX_YIELD_TIME_MS).optional(),
});

interface CommandSession {
  child: ChildProcessWithoutNullStreams;
  completed: Promise<void>;
  output: string;
  outputOffset: number;
  exitCode?: number;
  error?: Error;
  startedAt: number;
}

export interface CommandResult {
  output: string;
  wall_time_seconds: number;
  exit_code?: number;
  session_id?: number;
}

export class SandboxCommandExecutor {
  private readonly sessions = new Map<number, CommandSession>();
  private nextSessionId = 1;

  public constructor(private readonly defaultWorkingDirectory: string) {}

  public async execCommandAsync(params: unknown): Promise<CommandResult> {
    const parsedParams = execCommandParamsSchema.parse(params);
    const sessionId = this.nextSessionId++;
    const session = this.startCommand(
      parsedParams.cmd,
      parsedParams.workdir
        ? path.resolve(this.defaultWorkingDirectory, parsedParams.workdir)
        : this.defaultWorkingDirectory
    );
    this.sessions.set(sessionId, session);

    return await this.readSessionAsync(
      sessionId,
      session,
      parsedParams.yield_time_ms ?? DEFAULT_EXEC_YIELD_TIME_MS
    );
  }

  public async writeStdinAsync(params: unknown): Promise<CommandResult> {
    const parsedParams = writeStdinParamsSchema.parse(params);
    const session = this.sessions.get(parsedParams.session_id);
    if (!session) {
      throw new Error(`Command session ${parsedParams.session_id} does not exist.`);
    }
    if (parsedParams.chars && session.exitCode === undefined && !session.error) {
      session.child.stdin.write(parsedParams.chars);
    }

    return await this.readSessionAsync(
      parsedParams.session_id,
      session,
      parsedParams.yield_time_ms ?? DEFAULT_WRITE_YIELD_TIME_MS
    );
  }

  public stop(): void {
    for (const session of this.sessions.values()) {
      session.child.kill();
    }
    this.sessions.clear();
  }

  private startCommand(command: string, workingDirectory: string): CommandSession {
    const child = spawn(command, {
      cwd: workingDirectory,
      env: process.env,
      shell: process.env.SHELL ?? true,
    });
    let resolveCompleted!: () => void;
    const session: CommandSession = {
      child,
      completed: new Promise<void>(resolve => {
        resolveCompleted = resolve;
      }),
      output: '',
      outputOffset: 0,
      startedAt: Date.now(),
    };
    child.stdout.on('data', data => {
      session.output += data.toString();
    });
    child.stderr.on('data', data => {
      session.output += data.toString();
    });
    child.stdin.on('error', error => {
      session.error = error;
      resolveCompleted();
    });
    child.once('error', error => {
      session.error = error;
      resolveCompleted();
    });
    child.once('close', exitCode => {
      session.exitCode = exitCode ?? 1;
      resolveCompleted();
    });
    return session;
  }

  private async readSessionAsync(
    sessionId: number,
    session: CommandSession,
    yieldTimeMs: number
  ): Promise<CommandResult> {
    await new Promise<void>(resolve => {
      const timer = setTimeout(resolve, yieldTimeMs);
      void session.completed.then(() => {
        clearTimeout(timer);
        resolve();
      });
    });
    if (session.error) {
      this.sessions.delete(sessionId);
      throw session.error;
    }

    const output = session.output.slice(session.outputOffset);
    session.outputOffset = session.output.length;
    const result: CommandResult = {
      output,
      wall_time_seconds: (Date.now() - session.startedAt) / 1_000,
    };
    if (session.exitCode !== undefined) {
      this.sessions.delete(sessionId);
      return { ...result, exit_code: session.exitCode };
    }
    return { ...result, session_id: sessionId };
  }
}
