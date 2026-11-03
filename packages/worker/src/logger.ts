import { HttpLogStream, LogBuffer, RemoteLoggerStream } from '@expo/build-tools';
import { BuildPhase, Job } from '@expo/eas-build-job';
import { LoggerLevel, bunyan, createLogger } from '@expo/logger';
import { Readable, Transform, TransformCallback, Writable } from 'stream';

import config from './config';
import { maybeStringBase64Decode, simpleSecretsWhitelist } from './secrets';
import { uuidv7 } from 'uuidv7';

const MAX_LINES_IN_BUFFER = 100;

interface CachedLog {
  msg: string;
  phase: string;
}

export class WorkerLogBuffer extends Writable implements LogBuffer {
  public writable: boolean = true;
  public buffer: CachedLog[] = [];

  constructor(
    private readonly numberOfLines: number,
    private readonly secretPatterns: ReadonlySet<string>
  ) {
    super();
  }

  public write(rec: any): boolean {
    if (
      // verify required fields
      typeof rec !== 'object' ||
      typeof rec?.msg !== 'string' ||
      typeof rec?.phase !== 'string' ||
      // use only logs from spawn commands
      (rec?.source !== 'stdout' && rec?.source !== 'stderr') ||
      // skip all short lines (it could potentially be some loader)
      (rec?.msg ?? '').length < 3
    ) {
      return true;
    }
    if (this.buffer.length >= this.numberOfLines) {
      this.buffer.shift();
    }
    this.buffer.push({ msg: maskSecrets(rec.msg, this.secretPatterns), phase: rec.phase });
    return true;
  }

  public getLogs(): string[] {
    return this.buffer.map(({ msg }) => msg);
  }

  public getPhaseLogs(buildPhase: string): string[] {
    return this.buffer.filter(({ phase }) => phase === buildPhase).map(({ msg }) => msg);
  }
}

// Bunyan's own fields and fields that identify a log line, which never hold user data.
const UNMASKED_FIELDS = new Set([
  'name',
  'pid',
  'level',
  'time',
  'v',
  'phase',
  'source',
  'marker',
  'result',
  'buildStepId',
  'buildStepInternalId',
]);
const MAX_MASKED_DEPTH = 20;

function createTransformStream(secretPatterns: ReadonlySet<string>): Transform {
  return new Transform({
    readableObjectMode: true,
    writableObjectMode: true,
    transform(_chunk: any, _encoding: BufferEncoding, callback: TransformCallback) {
      if (!_chunk || typeof _chunk !== 'object') {
        callback(null, _chunk);
        return;
      }
      // Remove hostname from logs since we don't need it. Bunyan shares the record with other
      // streams, so build a copy instead of changing it.
      const { hostname: _hostname, ...rest } = _chunk;
      const chunk: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(rest)) {
        // Secrets can be in any field, such as a serialized error's message and stack.
        chunk[key] = UNMASKED_FIELDS.has(key) ? value : maskSecretsInValue(value, secretPatterns);
      }
      // Add logId to each log.
      chunk.logId = uuidv7();
      callback(null, chunk);
    },
  });
}

function maskSecrets(message: string, secrets: Iterable<string>): string {
  const characters = message.split('');
  for (const secret of secrets) {
    for (
      let start = message.indexOf(secret);
      start !== -1;
      start = message.indexOf(secret, start + 1)
    ) {
      characters.fill('*', start, start + secret.length);
    }
  }
  return characters.join('');
}

function maskSecretsInValue(value: unknown, secrets: ReadonlySet<string>): unknown {
  if (value === null || typeof value !== 'object') {
    return maskSecretsInJsonValue(value, secrets, 0);
  }
  // Mask what the upload streams will serialize, so a toJSON method can't bring back the original.
  let json: unknown;
  try {
    json = JSON.parse(JSON.stringify(value));
  } catch {
    return '[Unserializable]';
  }
  return secrets.size === 0 ? json : maskSecretsInJsonValue(json, secrets, 0);
}

function maskSecretsInJsonValue(
  value: unknown,
  secrets: ReadonlySet<string>,
  depth: number
): unknown {
  if (typeof value === 'string') {
    return maskSecrets(value, secrets);
  }
  if (typeof value === 'number') {
    return secrets.has(String(value)) ? maskSecrets(String(value), secrets) : value;
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (depth >= MAX_MASKED_DEPTH) {
    return '[Truncated]';
  }
  if (Array.isArray(value)) {
    return value.map(item => maskSecretsInJsonValue(item, secrets, depth + 1));
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      maskSecrets(key, secrets),
      maskSecretsInJsonValue(item, secrets, depth + 1),
    ])
  );
}

function createStdoutStream(): Writable {
  return new Writable({
    objectMode: true,
    write(chunk: any, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
      process.stdout.write(`${JSON.stringify(chunk)}\n`);
      callback(null);
    },
  });
}

const secretPatterns = new Set<string>();

function addBuildLogMask(secret: string): void {
  for (const pattern of [secret, maybeStringBase64Decode(secret)]) {
    if (pattern && pattern.length > 1 && !simpleSecretsWhitelist.includes(pattern)) {
      secretPatterns.add(pattern);
    }
  }
}

function createStdoutMaskingStream(): Transform {
  const transformStream = createTransformStream(secretPatterns);
  transformStream.pipe(createStdoutStream());
  return transformStream;
}

const defaultLogger = createLogger({
  name: config.loggers.base.name,
  level: LoggerLevel.INFO,
  streams: [{ type: 'raw', stream: createStdoutMaskingStream(), reemitErrorEvents: true }],
});

export async function createBuildLoggerWithSecretsFilter(secrets: Job['secrets']): Promise<{
  logger: bunyan;
  addBuildLogMask: (secret: string) => void;
  cleanUp: () => Promise<void>;
  logBuffer: WorkerLogBuffer;
  outputStream: Readable;
}> {
  for (const { value } of secrets?.environmentSecrets ?? []) {
    addBuildLogMask(value);
  }

  const transformStream = createStdoutMaskingStream();
  const buildLogger = createLogger({
    name: config.loggers.base.name,
    level: defaultLogger.level(),
    phase: BuildPhase.UNKNOWN,
    streams: [{ type: 'raw', stream: transformStream, reemitErrorEvents: true }],
  });

  let remoteLoggerStream: RemoteLoggerStream | null = null;
  if (config.loggers.gcs.signedUploadUrlForLogs) {
    remoteLoggerStream = new RemoteLoggerStream({
      uploadMethod: { signedUrl: config.loggers.gcs.signedUploadUrlForLogs },
      options: {
        uploadIntervalMs: config.loggers.gcs.uploadIntervalMs,
        compress: config.loggers.gcs.compressionMethod,
      },
      logger: defaultLogger,
    });
    transformStream.pipe(remoteLoggerStream);
    await remoteLoggerStream.init();
  }

  const logBuffer = new WorkerLogBuffer(MAX_LINES_IN_BUFFER, secretPatterns);
  buildLogger.addStream({
    type: 'raw',
    stream: logBuffer,
    reemitErrorEvents: true,
    level: buildLogger.level(),
  });

  let httpLogStream: HttpLogStream | null = null;
  if (config.loggers.http.baseUrl && secrets?.robotAccessToken) {
    httpLogStream = new HttpLogStream({
      url: new URL(config.buildId, config.loggers.http.baseUrl).toString(),
      headers: {
        Authorization: `Bearer ${secrets.robotAccessToken}`,
      },
      logger: defaultLogger,
      bufferRetentionMs: config.loggers.gcs.signedUploadUrlForLogs
        ? Math.max(30_000, config.loggers.gcs.uploadIntervalMs * 2)
        : null,
    });
    transformStream.pipe(httpLogStream);
  }

  return {
    logger: buildLogger,
    addBuildLogMask,
    cleanUp: async () => {
      await Promise.all([remoteLoggerStream?.cleanUp?.(), httpLogStream?.cleanUp?.()]);
    },
    outputStream: transformStream,
    logBuffer,
  };
}

export default defaultLogger;
