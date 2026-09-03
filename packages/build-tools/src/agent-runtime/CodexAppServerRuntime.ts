import { errors } from '@expo/eas-build-job';
import type { bunyan } from '@expo/logger';
import {
  type ChildProcessWithoutNullStreams,
  spawn as spawnChildProcess,
} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout as sleepAsync } from 'node:timers/promises';
import { z } from 'zod';

import { AgentAuthLeaseClient, type AgentProviderRuntimeLease } from './AgentAuthLeaseClient';
import { CODEX_VERSION } from './CodexExecRuntime';
import { assertAgentExecutableVersionAsync } from './processUtils';

const PROACTIVE_REFRESH_MARGIN_MS = 60 * 1000;
const HOST_REFRESH_TIMEOUT_MS = 8 * 1000;
const REQUEST_TIMEOUT_MS = 30 * 1000;
const TURN_INTERRUPT_GRACE_MS = 5 * 1000;

const JsonRpcMessageZ = z.looseObject({
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string().optional(),
  params: z.unknown().optional(),
  result: z.unknown().optional(),
  error: z.unknown().optional(),
});

const RefreshParamsZ = z.strictObject({
  reason: z.literal('unauthorized'),
  previousAccountId: z.string().nullable().optional(),
});

const ThreadStartResponseZ = z.looseObject({
  thread: z.looseObject({ id: z.string().min(1) }),
});

const TurnStartResponseZ = z.looseObject({
  turn: z.looseObject({ id: z.string().min(1) }),
});

const AgentMessageItemZ = z.looseObject({
  type: z.literal('agentMessage'),
  text: z.string(),
});

const TurnCompletedParamsZ = z.looseObject({
  threadId: z.string().min(1),
  turn: z.looseObject({
    id: z.string().min(1),
    status: z.enum(['completed', 'failed', 'interrupted']),
    items: z.array(z.unknown()).optional(),
  }),
});

const ItemCompletedParamsZ = z.looseObject({
  threadId: z.string().min(1),
  turnId: z.string().min(1),
  item: z.unknown(),
});

type OpenAILease = Extract<AgentProviderRuntimeLease, { provider: 'openai' }>;

export type CodexTurnResult = {
  threadId: string;
  turnId: string;
  finalResponse: string;
};

export class CodexAppServerRuntime {
  public constructor(
    private readonly leaseClient: AgentAuthLeaseClient,
    private readonly executable = 'codex',
    private readonly spawnProcess: typeof spawnChildProcess = spawnChildProcess
  ) {}

  public async startAsync({
    cwd,
    env,
    logger,
    signal,
  }: {
    cwd?: string;
    env: NodeJS.ProcessEnv;
    logger: bunyan;
    signal?: AbortSignal;
  }): Promise<CodexAppServerSession> {
    await assertAgentExecutableVersionAsync({
      executable: this.executable,
      expectedVersion: CODEX_VERSION,
      displayName: 'Codex CLI',
    });
    const lease = await this.leaseClient.getLeaseAsync({ reason: 'startup' }, signal);
    if (lease.provider !== 'openai') {
      throw new errors.UserError(
        'EAS_AGENT_PROVIDER_MISMATCH',
        'This agent job is bound to a different provider. Select a Codex connection and start a new job.'
      );
    }
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-codex-app-server-'));
    const processEnv: NodeJS.ProcessEnv = { ...env, CODEX_HOME: codexHome };
    delete processEnv.OPENAI_API_KEY;
    const child = this.spawnProcess(this.executable, ['app-server'], {
      cwd,
      env: processEnv,
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const session = new CodexAppServerSession({
      child,
      codexHome,
      initialLease: lease,
      leaseClient: this.leaseClient,
      logger,
      signal,
    });
    try {
      await session.initializeAsync();
      return session;
    } catch (error) {
      await session.stopAsync();
      if (signal?.aborted) {
        throw new errors.UserError(
          'EAS_AGENT_JOB_CANCELLED',
          'The agent job was cancelled while Codex app-server was starting.'
        );
      }
      throw new errors.UserError(
        'EAS_AGENT_CODEX_PROTOCOL_UNSUPPORTED',
        'The installed Codex app-server does not support EAS external authentication. Update the worker runtime and start a new job.',
        { cause: error }
      );
    }
  }
}

export class CodexAppServerSession {
  private currentLease: OpenAILease;
  private nextRequestId = 1;
  private readonly pendingRequests = new Map<
    string | number,
    {
      resolve: (result: unknown) => void;
      reject: (error: Error) => void;
      timeout: NodeJS.Timeout;
    }
  >();
  private refreshOperation: Promise<OpenAILease> | null = null;
  private proactiveRefreshTimer: NodeJS.Timeout | null = null;
  private cleanupPromise: Promise<void> | null = null;
  private fatalError: Error | null = null;
  private hasReportedStderr = false;
  private stopped = false;
  private readonly sessionAbortController = new AbortController();
  private readonly completedTurns = new Map<string, z.infer<typeof TurnCompletedParamsZ>>();
  private readonly finalResponses = new Map<string, string>();
  private readonly interruptedTurnCleanupTimers = new Map<string, NodeJS.Timeout>();
  private readonly turnWaiters = new Map<
    string,
    {
      threadId: string;
      resolve: (result: z.infer<typeof TurnCompletedParamsZ>) => void;
      reject: (error: Error) => void;
      timeout: NodeJS.Timeout;
    }
  >();

  public constructor(
    private readonly options: {
      child: ChildProcessWithoutNullStreams;
      codexHome: string;
      initialLease: OpenAILease;
      leaseClient: AgentAuthLeaseClient;
      logger: bunyan;
      signal?: AbortSignal;
    }
  ) {
    this.currentLease = options.initialLease;
    const lines = createInterface({ input: options.child.stdout });
    lines.on('line', line => {
      this.handleLine(line);
    });
    options.child.on('exit', () => {
      this.stopped = true;
      const error =
        this.fatalError ?? new Error('Codex app-server stopped before the request completed.');
      this.rejectPendingRequests(error);
      this.rejectTurnWaiters(error);
      void this.stopAsync();
    });
    options.child.on('error', error => {
      this.fail(new Error('Codex app-server could not start.', { cause: error }));
    });
    options.child.stdin.on('error', error => {
      this.fail(new Error('EAS could not send a request to Codex app-server.', { cause: error }));
    });
    options.child.stderr.on('data', () => {
      if (this.hasReportedStderr) {
        return;
      }
      this.hasReportedStderr = true;
      options.logger.warn(
        'Codex app-server reported an error. Its output was hidden to protect provider credentials.'
      );
    });
    if (options.signal?.aborted) {
      void this.stopAsync();
    } else {
      options.signal?.addEventListener('abort', this.handleAbort, { once: true });
    }
  }

  public async initializeAsync(): Promise<void> {
    await this.requestAsync('initialize', {
      clientInfo: { name: 'eas-agent-runtime', title: 'EAS Agent Runtime', version: '1.0.0' },
      capabilities: { experimentalApi: true },
    });
    this.notify('initialized');
    await this.loginAsync(this.currentLease);
    this.scheduleProactiveRefresh();
  }

  public async startThreadAsync({ cwd }: { cwd?: string }): Promise<{ id: string }> {
    const response = ThreadStartResponseZ.safeParse(
      await this.requestAsync('thread/start', {
        ...(cwd ? { cwd } : {}),
        approvalPolicy: 'never',
        sandbox: 'workspace-write',
      })
    );
    if (!response.success) {
      throw new errors.UserError(
        'EAS_AGENT_CODEX_PROTOCOL_UNSUPPORTED',
        'Codex app-server returned an invalid thread response. Update the worker runtime and start a new job.',
        { cause: response.error }
      );
    }
    return { id: response.data.thread.id };
  }

  public async runTurnAsync({
    threadId,
    prompt,
    maximumInvocationSeconds,
  }: {
    threadId: string;
    prompt: string;
    maximumInvocationSeconds: number;
  }): Promise<CodexTurnResult> {
    const response = TurnStartResponseZ.safeParse(
      await this.requestAsync('turn/start', {
        threadId,
        input: [{ type: 'text', text: prompt, textElements: [] }],
      })
    );
    if (!response.success) {
      throw new errors.UserError(
        'EAS_AGENT_CODEX_PROTOCOL_UNSUPPORTED',
        'Codex app-server returned an invalid turn response. Update the worker runtime and start a new job.',
        { cause: response.error }
      );
    }
    const turnId = response.data.turn.id;
    const completion = await this.waitForTurnAsync({
      threadId,
      turnId,
      maximumInvocationSeconds,
    });
    switch (completion.turn.status) {
      case 'completed':
        return {
          threadId,
          turnId,
          finalResponse:
            this.finalResponses.get(turnId) ??
            getFinalAgentResponse(completion.turn.items ?? []) ??
            '',
        };
      case 'failed':
        throw new errors.UserError(
          'EAS_AGENT_CODEX_TURN_FAILED',
          'Codex could not complete the agent turn. Review the job log and try again.'
        );
      case 'interrupted':
        throw new errors.UserError(
          'EAS_AGENT_CODEX_TURN_INTERRUPTED',
          'The Codex agent turn was interrupted before it completed. Start the job again.'
        );
    }
  }

  private async requestAsync(method: string, params?: unknown): Promise<unknown> {
    if (this.fatalError) {
      throw this.fatalError;
    }
    if (this.stopped) {
      throw new Error('Codex app-server is stopped.');
    }
    const id = this.nextRequestId++;
    const result = new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Codex app-server did not answer ${method} in time.`));
      }, REQUEST_TIMEOUT_MS);
      this.pendingRequests.set(id, { resolve, reject, timeout });
    });
    this.write({ id, method, ...(params === undefined ? {} : { params }) });
    return await result;
  }

  private notify(method: string, params?: unknown): void {
    this.write({ method, ...(params === undefined ? {} : { params }) });
  }

  public async stopAsync(): Promise<void> {
    const wasStopped = this.stopped;
    this.stopped = true;
    this.sessionAbortController.abort();
    if (this.proactiveRefreshTimer) {
      clearTimeout(this.proactiveRefreshTimer);
      this.proactiveRefreshTimer = null;
    }
    for (const timeout of this.interruptedTurnCleanupTimers.values()) {
      clearTimeout(timeout);
    }
    this.interruptedTurnCleanupTimers.clear();
    this.options.signal?.removeEventListener('abort', this.handleAbort);
    if (wasStopped) {
      await this.cleanUpAsync();
      return;
    }
    await stopProcessGroupAsync(this.options.child);
    this.rejectPendingRequests(new Error('Codex app-server was stopped.'));
    this.rejectTurnWaiters(new Error('Codex app-server was stopped.'));
    await this.cleanUpAsync();
  }

  private readonly handleAbort = (): void => {
    void this.stopAsync();
  };

  private handleLine(line: string): void {
    const parsedMessage = JsonRpcMessageZ.safeParse(parseJson(line));
    if (!parsedMessage.success) {
      this.fail(new Error('Codex app-server returned an invalid protocol message.'));
      return;
    }
    const message = parsedMessage.data;
    if (message.method === 'account/chatgptAuthTokens/refresh' && message.id !== undefined) {
      void this.handleUnauthorizedRefreshAsync(message.id, message.params);
      return;
    }
    if (message.method === 'turn/completed') {
      this.handleTurnCompleted(message.params);
      return;
    }
    if (message.method === 'item/completed') {
      this.handleItemCompleted(message.params);
      return;
    }
    if (message.method && message.id !== undefined) {
      this.write({
        id: message.id,
        error: { code: -32601, message: 'This EAS agent runtime does not support the request.' },
      });
      this.fail(new Error('Codex app-server requested an unsupported host capability.'));
      return;
    }
    if (message.id === undefined || message.method) {
      return;
    }
    const pending = this.pendingRequests.get(message.id);
    if (!pending) {
      return;
    }
    this.pendingRequests.delete(message.id);
    clearTimeout(pending.timeout);
    if (message.error !== undefined) {
      pending.reject(new Error('Codex app-server rejected an EAS runtime request.'));
    } else {
      pending.resolve(message.result);
    }
  }

  private async handleUnauthorizedRefreshAsync(
    requestId: string | number,
    rawParams: unknown
  ): Promise<void> {
    const params = RefreshParamsZ.safeParse(rawParams);
    if (
      !params.success ||
      (params.data.previousAccountId &&
        params.data.previousAccountId !== this.currentLease.accountId)
    ) {
      this.writeRefreshError(requestId);
      return;
    }
    const timeoutController = new AbortController();
    const timeout = setTimeout(() => timeoutController.abort(), HOST_REFRESH_TIMEOUT_MS);
    try {
      const lease = await this.refreshLeaseAsync(
        'unauthorized',
        /* applyToServer */ false,
        timeoutController.signal
      );
      this.write({
        id: requestId,
        result: {
          accessToken: lease.accessToken,
          chatgptAccountId: lease.accountId,
          chatgptPlanType: lease.plan,
        },
      });
    } catch {
      this.writeRefreshError(requestId);
    } finally {
      clearTimeout(timeout);
    }
  }

  private writeRefreshError(requestId: string | number): void {
    this.write({
      id: requestId,
      error: { code: -32000, message: 'EAS could not refresh provider access.' },
    });
  }

  private handleItemCompleted(rawParams: unknown): void {
    const params = ItemCompletedParamsZ.safeParse(rawParams);
    if (!params.success) {
      return;
    }
    const item = AgentMessageItemZ.safeParse(params.data.item);
    if (item.success) {
      this.finalResponses.set(params.data.turnId, item.data.text);
    }
  }

  private handleTurnCompleted(rawParams: unknown): void {
    const params = TurnCompletedParamsZ.safeParse(rawParams);
    if (!params.success) {
      this.fail(new Error('Codex app-server returned an invalid turn completion.'));
      return;
    }
    const waiter = this.turnWaiters.get(params.data.turn.id);
    const cleanupTimer = this.interruptedTurnCleanupTimers.get(params.data.turn.id);
    if (cleanupTimer) {
      clearTimeout(cleanupTimer);
      this.interruptedTurnCleanupTimers.delete(params.data.turn.id);
    }
    if (!waiter) {
      this.completedTurns.set(params.data.turn.id, params.data);
      if (this.completedTurns.size > 20) {
        this.completedTurns.delete(this.completedTurns.keys().next().value!);
      }
      return;
    }
    if (waiter.threadId !== params.data.threadId) {
      return;
    }
    this.turnWaiters.delete(params.data.turn.id);
    clearTimeout(waiter.timeout);
    waiter.resolve(params.data);
  }

  private async waitForTurnAsync({
    threadId,
    turnId,
    maximumInvocationSeconds,
  }: {
    threadId: string;
    turnId: string;
    maximumInvocationSeconds: number;
  }): Promise<z.infer<typeof TurnCompletedParamsZ>> {
    const completed = this.completedTurns.get(turnId);
    if (completed?.threadId === threadId) {
      this.completedTurns.delete(turnId);
      return completed;
    }
    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.turnWaiters.delete(turnId);
        void this.interruptTimedOutTurnAsync(threadId, turnId);
        reject(
          new errors.UserError(
            'EAS_AGENT_INVOCATION_TIMEOUT',
            'The Codex agent turn exceeded the job time limit and was stopped. Reduce the task scope and try again.'
          )
        );
      }, maximumInvocationSeconds * 1000);
      this.turnWaiters.set(turnId, { threadId, resolve, reject, timeout });
    });
  }

  private async interruptTimedOutTurnAsync(threadId: string, turnId: string): Promise<void> {
    const timeoutController = new AbortController();
    const timeout = setTimeout(() => timeoutController.abort(), TURN_INTERRUPT_GRACE_MS);
    try {
      await Promise.race([
        this.requestAsync('turn/interrupt', { threadId, turnId }),
        new Promise((_, reject) => {
          timeoutController.signal.addEventListener(
            'abort',
            () => reject(new Error('Codex app-server did not interrupt the turn in time.')),
            { once: true }
          );
        }),
      ]);
      this.interruptedTurnCleanupTimers.set(
        turnId,
        setTimeout(() => {
          this.interruptedTurnCleanupTimers.delete(turnId);
          void this.stopAsync();
        }, TURN_INTERRUPT_GRACE_MS)
      );
    } catch {
      await this.stopAsync();
    } finally {
      clearTimeout(timeout);
    }
  }

  private async refreshLeaseAsync(
    reason: 'proactive' | 'unauthorized',
    applyToServer: boolean,
    signal?: AbortSignal
  ): Promise<OpenAILease> {
    if (!this.refreshOperation) {
      const operation = async () => {
        const combinedSignal = signal
          ? AbortSignal.any([signal, this.sessionAbortController.signal])
          : this.sessionAbortController.signal;
        const lease = await this.options.leaseClient.getLeaseAsync(
          reason === 'unauthorized'
            ? {
                reason,
                previousAccessTokenFingerprint: this.currentLease.accessTokenFingerprint,
              }
            : { reason },
          combinedSignal
        );
        if (lease.provider !== 'openai' || lease.accountId !== this.currentLease.accountId) {
          throw new errors.UserError(
            'EAS_AGENT_PROVIDER_IDENTITY_CHANGED',
            'The provider connection changed to another ChatGPT account during this job. Start a new job with the intended connection.'
          );
        }
        if (this.stopped) {
          throw new Error('Codex app-server stopped while provider access was refreshing.');
        }
        if (new Date(lease.expiresAt).getTime() - Date.now() <= PROACTIVE_REFRESH_MARGIN_MS) {
          throw new errors.UserError(
            'EAS_AGENT_PROVIDER_LEASE_TOO_SHORT',
            'The provider access lease is too short for Codex app-server. Start a new job after reconnecting the provider.'
          );
        }
        if (applyToServer) {
          await this.loginAsync(lease);
        }
        this.currentLease = lease;
        this.scheduleProactiveRefresh();
        return lease;
      };
      this.refreshOperation = operation().finally(() => {
        this.refreshOperation = null;
      });
    }
    return await this.refreshOperation;
  }

  private scheduleProactiveRefresh(): void {
    if (this.stopped) {
      return;
    }
    if (this.proactiveRefreshTimer) {
      clearTimeout(this.proactiveRefreshTimer);
    }
    const delay = Math.max(
      0,
      new Date(this.currentLease.expiresAt).getTime() - Date.now() - PROACTIVE_REFRESH_MARGIN_MS
    );
    this.proactiveRefreshTimer = setTimeout(() => {
      void this.refreshLeaseAsync('proactive', /* applyToServer */ true).catch(error => {
        this.fail(
          error instanceof Error
            ? error
            : new Error('Codex app-server provider access refresh failed.')
        );
      });
    }, delay);
  }

  private async loginAsync(lease: OpenAILease): Promise<void> {
    await this.requestAsync('account/login/start', {
      type: 'chatgptAuthTokens',
      accessToken: lease.accessToken,
      chatgptAccountId: lease.accountId,
      chatgptPlanType: lease.plan,
    });
  }

  private write(message: Record<string, unknown>): void {
    if (!this.stopped) {
      this.options.child.stdin.write(`${JSON.stringify(message)}\n`);
    }
  }

  private fail(error: Error): void {
    this.fatalError = error;
    this.rejectPendingRequests(error);
    void this.stopAsync();
  }

  private rejectPendingRequests(error: Error): void {
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  private rejectTurnWaiters(error: Error): void {
    for (const waiter of this.turnWaiters.values()) {
      clearTimeout(waiter.timeout);
      waiter.reject(error);
    }
    this.turnWaiters.clear();
  }

  private async cleanUpAsync(): Promise<void> {
    if (!this.cleanupPromise) {
      this.cleanupPromise = fs.rm(this.options.codexHome, { recursive: true, force: true });
    }
    await this.cleanupPromise;
  }
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function getFinalAgentResponse(items: unknown[]): string | null {
  for (let index = items.length - 1; index >= 0; index--) {
    const item = AgentMessageItemZ.safeParse(items[index]);
    if (item.success) {
      return item.data.text;
    }
  }
  return null;
}

async function stopProcessGroupAsync(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null) {
    return;
  }
  if (child.pid === undefined) {
    child.kill('SIGTERM');
    return;
  }
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline && child.exitCode === null) {
    await sleepAsync(100);
  }
  if (child.exitCode !== null) {
    return;
  }
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
}
