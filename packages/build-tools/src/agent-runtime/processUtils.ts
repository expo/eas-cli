import { errors } from '@expo/eas-build-job';
import type { bunyan } from '@expo/logger';
import spawn, { type SpawnResult } from '@expo/turtle-spawn';
import { execFile } from 'node:child_process';
import { Transform } from 'node:stream';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function assertAgentExecutableVersionAsync({
  executable,
  expectedVersion,
  displayName,
}: {
  executable: string;
  expectedVersion: string;
  displayName: string;
}): Promise<void> {
  let versionOutput: string;
  try {
    const result = await execFileAsync(executable, ['--version'], { timeout: 10_000 });
    versionOutput = `${result.stdout}\n${result.stderr}`;
  } catch (error) {
    throw new errors.UserError(
      'EAS_AGENT_RUNTIME_UNAVAILABLE',
      `${displayName} is not available on this worker. Start a new job with a supported worker image.`,
      { cause: error }
    );
  }
  const reportedVersions = versionOutput.split(/\s+/).map(part => part.replace(/^v/, ''));
  if (!reportedVersions.includes(expectedVersion)) {
    throw new errors.UserError(
      'EAS_AGENT_RUNTIME_VERSION_UNSUPPORTED',
      `${displayName} ${expectedVersion} is required for this agent job. Start a new job with a supported worker image.`
    );
  }
}

export async function runBoundedAgentProcessAsync({
  command,
  args,
  cwd,
  env,
  logger,
  maximumInvocationSeconds,
  secrets,
  signal,
}: {
  command: string;
  args: string[];
  cwd?: string;
  env: NodeJS.ProcessEnv;
  logger: bunyan;
  maximumInvocationSeconds: number;
  secrets: string[];
  signal?: AbortSignal;
}): Promise<SpawnResult> {
  const abortController = new AbortController();
  let timedOut = false;
  const forwardAbort = (): void => {
    abortController.abort(signal?.reason);
  };
  if (signal?.aborted) {
    forwardAbort();
  } else {
    signal?.addEventListener('abort', forwardAbort, { once: true });
  }
  const timeout = setTimeout(() => {
    timedOut = true;
    abortController.abort();
  }, maximumInvocationSeconds * 1000);

  try {
    const processPromise = spawn(command, args, {
      cwd,
      env,
      signal: abortController.signal,
      stdio: 'pipe',
    });
    pipeRedactedOutput(processPromise.child.stdout, logger, 'info', secrets);
    pipeRedactedOutput(processPromise.child.stderr, logger, 'error', secrets);
    return await processPromise;
  } catch (error) {
    if (timedOut) {
      throw new errors.UserError(
        'EAS_AGENT_INVOCATION_TIMEOUT',
        `The agent exceeded its ${maximumInvocationSeconds}-second runtime limit. Start a new job with a shorter task.`,
        { cause: error }
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', forwardAbort);
  }
}

export function assertLeaseCoversInvocation(
  expiresAt: string,
  maximumInvocationSeconds: number
): void {
  if (new Date(expiresAt).getTime() - Date.now() < maximumInvocationSeconds * 1000) {
    throw new errors.UserError(
      'EAS_AGENT_PROVIDER_LEASE_TOO_SHORT',
      'The provider access token expires before this agent task can finish. Reconnect the provider and start a new job.'
    );
  }
}

function pipeRedactedOutput(
  output: NodeJS.ReadableStream | null,
  logger: bunyan,
  level: 'info' | 'error',
  secrets: string[]
): void {
  if (!output) {
    return;
  }
  const redactor = new SecretRedactingTransform(secrets);
  redactor.on('data', (chunk: Buffer) => {
    logger[level](chunk.toString());
  });
  output.pipe(redactor);
}

export class SecretRedactingTransform extends Transform {
  private pending = '';
  private readonly secrets: string[];
  private readonly maximumSecretLength: number;

  public constructor(secrets: string[]) {
    super();
    this.secrets = secrets.filter(secret => secret.length > 0);
    this.maximumSecretLength = Math.max(1, ...this.secrets.map(secret => secret.length));
  }

  public override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void
  ): void {
    this.pending += chunk.toString();
    let safeLength = Math.max(0, this.pending.length - this.maximumSecretLength + 1);
    for (const secret of this.secrets) {
      let index = this.pending.indexOf(secret);
      while (index !== -1) {
        if (index < safeLength && index + secret.length > safeLength) {
          safeLength = index;
        }
        index = this.pending.indexOf(secret, index + 1);
      }
    }
    if (safeLength > 0) {
      this.push(redact(this.pending, this.secrets).slice(0, safeLength));
      this.pending = this.pending.slice(safeLength);
    }
    callback();
  }

  public override _flush(callback: (error?: Error | null) => void): void {
    this.push(redact(this.pending, this.secrets));
    this.pending = '';
    callback();
  }
}

function redact(value: string, secrets: string[]): string {
  return secrets.reduce((result, secret) => {
    return result.replaceAll(secret, '*'.repeat(secret.length));
  }, value);
}
