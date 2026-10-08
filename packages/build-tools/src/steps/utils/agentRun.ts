import { SystemError, UserError } from '@expo/eas-build-job';
import { type bunyan } from '@expo/logger';
import turtleSpawn from '@expo/turtle-spawn';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

import { leaseAgentRunProviderCredentialsAsync } from './agentRunLease';
import { type AgentCli, type AgentInvocation, type AgentLogMessage } from './agents/agent';
import { CLAUDE_CODE_CLI, prepareClaudeCodeAsync } from './agents/claude';
import { CODEX_CLI, prepareCodexAsync } from './agents/codex';
import { Sentry } from '../../sentry';
import { killProcessGroup } from '../../utils/processes';

export type AgentKind = 'claude-code' | 'codex';

const AGENT_CLIS: Record<AgentKind, AgentCli> = {
  'claude-code': CLAUDE_CODE_CLI,
  codex: CODEX_CLI,
};
export const AGENT_KINDS = Object.keys(AGENT_CLIS) as AgentKind[];
const KILL_GRACE_PERIOD_MS = 10_000;
const OUTPUT_CLOSE_GRACE_PERIOD_MS = 5_000;

export async function runAgentAsync({
  agentKind,
  agentRunId,
  maxDurationSeconds,
  prompt,
  expoToken,
  expoApiV2BaseUrl,
  mcpUrl,
  pathEnv,
  npmRegistryUrl,
  logger,
  signal,
}: {
  agentKind: AgentKind;
  agentRunId: string;
  maxDurationSeconds: number;
  prompt: string;
  expoToken: string;
  expoApiV2BaseUrl: string;
  /** The Expo MCP server's streamable HTTP endpoint. */
  mcpUrl: string;
  pathEnv: string;
  npmRegistryUrl?: string;
  logger: bunyan;
  signal?: AbortSignal;
}): Promise<void> {
  const leaseOptions = { expoApiV2BaseUrl, expoToken, agentRunId, signal };
  let credentials = await leaseAgentRunProviderCredentialsAsync(leaseOptions);
  const secrets = new Set([expoToken]);

  const runDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-agent-run-'));
  try {
    const cliDirectory = path.join(runDirectory, 'cli');
    const homeDirectory = path.join(runDirectory, 'home');
    const tmpDirectory = path.join(runDirectory, 'tmp');
    const workingDirectory = path.join(runDirectory, 'cwd');
    await Promise.all(
      [cliDirectory, homeDirectory, tmpDirectory, workingDirectory].map(directory =>
        fs.mkdir(directory)
      )
    );
    // Of the job's environment, only `PATH` reaches npm and the agent.
    const minimalEnv = {
      PATH: pathEnv,
      HOME: homeDirectory,
      TMPDIR: tmpDirectory,
      LANG: 'C.UTF-8',
    };

    const { packageSpec, bin, formatOutputLine } = AGENT_CLIS[agentKind];
    logger.info(`Installing ${packageSpec}.`);
    try {
      await turtleSpawn(
        'npm',
        [
          'install',
          ...['--prefix', cliDirectory],
          ...['--no-save', '--package-lock=false', '--no-audit', '--no-fund'],
          ...(npmRegistryUrl ? ['--registry', npmRegistryUrl] : []),
          packageSpec,
        ],
        { env: minimalEnv, signal }
      );
    } catch (error) {
      signal?.throwIfAborted();
      throw new SystemError(
        `Could not install ${packageSpec} on the worker, so the agent cannot start. This is usually a temporary network or registry problem; start the agent run again.`,
        { cause: error }
      );
    }

    const mcpServer = {
      url: mcpUrl,
      headers: { Authorization: `Bearer ${expoToken}`, 'X-Expo-Agent-Run-Id': agentRunId },
    };
    const claudeSessionId = randomUUID();
    const deadline = Date.now() + maxDurationSeconds * 1000;
    logger.info('Starting the agent.');
    for (let isResuming = false; ; isResuming = true) {
      if (Date.now() >= deadline) {
        throw createTimeoutError(maxDurationSeconds);
      }
      let invocation: AgentInvocation;
      switch (agentKind) {
        case 'claude-code':
          invocation = await prepareClaudeCodeAsync({
            homeDirectory,
            minimalEnv,
            mcpServer,
            sessionId: claudeSessionId,
            prompt,
            credentials,
            isResuming,
          });
          break;
        case 'codex':
          invocation = await prepareCodexAsync({
            homeDirectory,
            minimalEnv,
            mcpServer,
            prompt,
            credentials,
            isResuming,
          });
          break;
      }

      for (const secret of invocation.secrets) {
        secrets.add(secret);
      }
      const { exitCode, exitSignal } = await runAgentProcessAsync({
        command: path.join(cliDirectory, 'node_modules', '.bin', bin),
        ...invocation,
        cwd: workingDirectory,
        deadline,
        maxDurationSeconds,
        formatOutputLine,
        secrets: [...secrets],
        logger,
        signal,
      });
      if (exitCode === 0) {
        return;
      }
      const exitDescription = exitSignal
        ? `was terminated by ${exitSignal}`
        : `exited with code ${exitCode}`;

      // www hands out the stored token until it has expired, so a different token means the
      // one the agent used has expired.
      const nextCredentials = await leaseAgentRunProviderCredentialsAsync(leaseOptions);
      if (nextCredentials.accessToken === credentials.accessToken) {
        throw new UserError(
          'EAS_RUN_AGENT_FAILED',
          `The agent ${exitDescription} before it finished the task. Its output above shows what went wrong; fix the cause and start a new agent run.`
        );
      }
      logger.info(
        `The agent ${exitDescription} after its provider credentials expired. Resuming it with new credentials.`
      );
      credentials = nextCredentials;
    }
  } finally {
    await fs.rm(runDirectory, { recursive: true, force: true });
  }
}

async function runAgentProcessAsync({
  command,
  args,
  env,
  cwd,
  stdin,
  deadline,
  maxDurationSeconds,
  formatOutputLine,
  secrets,
  logger,
  signal,
}: {
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
  stdin: string;
  deadline: number;
  maxDurationSeconds: number;
  formatOutputLine: AgentCli['formatOutputLine'];
  secrets: string[];
  logger: bunyan;
  signal?: AbortSignal;
}): Promise<{ exitCode: number | null; exitSignal: NodeJS.Signals | null }> {
  signal?.throwIfAborted();
  // Detached, so the agent leads a process group that can be signaled as a whole.
  const child = spawn(command, args, { cwd, env, detached: true });
  const outputClosed = new Promise<void>(resolve => child.once('close', () => resolve()));
  const redact = (text: string): string =>
    secrets.reduce((masked, secret) => masked.replaceAll(secret, '[redacted]'), text);
  const stdoutLogger = logger.child({ source: 'stdout' });
  readline.createInterface({ input: child.stdout }).on('line', line => {
    let messages: AgentLogMessage[];
    try {
      messages = formatOutputLine(line);
    } catch (error) {
      // An exception in a readline listener is uncaught and would end the worker process.
      Sentry.capture('Could not format a line of the agent output', error as Error);
      return;
    }
    for (const { level, message } of messages) {
      stdoutLogger[level](redact(message).trimEnd());
    }
  });
  const stderrLogger = logger.child({ source: 'stderr' });
  readline.createInterface({ input: child.stderr }).on('line', line => {
    stderrLogger.info(redact(line));
  });
  // The agent may exit before it reads the prompt; its exit status reports that.
  child.stdin.on('error', () => {});
  child.stdin.end(stdin);

  let hasTimedOut = false;
  let killTimer: NodeJS.Timeout | undefined;
  const stop = (): void => {
    if (killTimer) {
      return;
    }
    killProcessGroup(child, 'SIGTERM');
    killTimer = setTimeout(() => killProcessGroup(child, 'SIGKILL'), KILL_GRACE_PERIOD_MS);
  };
  const deadlineTimer = setTimeout(() => {
    hasTimedOut = true;
    stop();
  }, deadline - Date.now());
  signal?.addEventListener('abort', stop);
  let exitCode: number | null;
  let exitSignal: NodeJS.Signals | null;
  try {
    [exitCode, exitSignal] = await once(child, 'exit');
  } catch (error: any) {
    // `once` rejects when the child emits `error`, which is how a failed spawn reports.
    throw new SystemError(
      `Could not start the agent CLI on the worker: ${error.message}. Start the agent run again, and contact Expo support if it keeps failing.`,
      { cause: error }
    );
  } finally {
    clearTimeout(deadlineTimer);
    clearTimeout(killTimer);
    signal?.removeEventListener('abort', stop);
  }

  // Whatever the agent left running ends with it. Something outside its process group could
  // still hold the output open, so the wait for the last lines is bounded.
  killProcessGroup(child, 'SIGKILL');
  let outputGraceTimer: NodeJS.Timeout | undefined;
  await Promise.race([
    outputClosed,
    new Promise<void>(resolve => {
      outputGraceTimer = setTimeout(resolve, OUTPUT_CLOSE_GRACE_PERIOD_MS);
    }),
  ]);
  clearTimeout(outputGraceTimer);

  if (hasTimedOut) {
    throw createTimeoutError(maxDurationSeconds);
  }
  signal?.throwIfAborted();
  return { exitCode, exitSignal };
}

function createTimeoutError(maxDurationSeconds: number): UserError {
  return new UserError(
    'EAS_RUN_AGENT_TIMEOUT',
    `The agent did not finish within its limit of ${maxDurationSeconds} seconds, so it was stopped. Raise the agent's maximum duration or give it a smaller task, then start a new agent run.`
  );
}
