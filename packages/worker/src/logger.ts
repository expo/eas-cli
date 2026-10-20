import { HttpLogStream, LogBuffer, RemoteLoggerStream } from '@expo/build-tools';
import { BuildPhase, Job } from '@expo/eas-build-job';
import { LoggerLevel, bunyan, createLogger } from '@expo/logger';
import { Readable, Transform, TransformCallback, Writable } from 'stream';

import config from './config';
import { maybeStringBase64Decode, simpleSecretsWhitelist } from './secrets';
import { uuidv7 } from 'uuidv7';

const defaultLogger = createLogger({
  name: config.loggers.base.name,
  level: LoggerLevel.INFO,
});

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
        chunk[key] =
          secretPatterns.size === 0 || UNMASKED_FIELDS.has(key)
            ? value
            : maskSecretsInValue(value, secretPatterns);
      }
      // Add logId to each log.
      chunk.logId = uuidv7();
      callback(null, chunk);
    },
  });
}

// Characters that Xcode escapes with a backslash when it prints build settings.
const XCODE_ESCAPED_CHARACTERS = /[\t !"#$&'()*;<=>?[\\\]^`{|}~]/g;

/**
 * Masks secrets in a text file's contents, line by line, including secrets written the way Xcode
 * prints build settings. Masking works on bytes, so everything else stays unchanged.
 */
export function createTextMaskingStream(secretPatterns: ReadonlySet<string>): Transform {
  const patterns = [
    ...new Set(
      [...secretPatterns].flatMap(secret => [
        secret,
        secret.replace(XCODE_ESCAPED_CHARACTERS, '\\$&'),
      ])
    ),
  ].map(pattern => Buffer.from(pattern).toString('latin1'));
  const maskLine = (line: string): string =>
    patterns.some(pattern => line.includes(pattern)) ? maskSecrets(line, patterns) : line;
  let partialLine = '';
  return new Transform({
    transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback) {
      const lines = (partialLine + chunk.toString('latin1')).split('\n');
      partialLine = lines.pop() ?? '';
      callback(
        null,
        lines.length > 0 ? Buffer.from(`${lines.map(maskLine).join('\n')}\n`, 'latin1') : undefined
      );
    },
    flush(callback: TransformCallback) {
      callback(null, partialLine ? Buffer.from(maskLine(partialLine), 'latin1') : undefined);
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
  return maskSecretsInJsonValue(json, secrets, 0);
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

function createDiscardStream(): Writable {
  return new Writable({
    objectMode: true,
    write(_chunk: any, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
      callback(null);
    },
  });
}

export async function createBuildLoggerWithSecretsFilter(secrets: Job['secrets']): Promise<{
  logger: bunyan;
  addBuildLogMask: (secret: string) => void;
  createLogMaskingStream: () => Transform;
  cleanUp: () => Promise<void>;
  logBuffer: WorkerLogBuffer;
  outputStream: Readable;
}> {
  const buildLogger = defaultLogger.child({ phase: BuildPhase.UNKNOWN });

  const secretPatterns = new Set<string>();
  const addBuildLogMask = (secret: string): void => {
    for (const pattern of [secret, maybeStringBase64Decode(secret)]) {
      if (pattern && pattern.length > 1 && !simpleSecretsWhitelist.includes(pattern)) {
        secretPatterns.add(pattern);
      }
    }
  };
  for (const { value } of secrets?.environmentSecrets ?? []) {
    addBuildLogMask(value);
  }

  const transformStream = createTransformStream(secretPatterns);
  const discardStream = createDiscardStream();
  transformStream.pipe(discardStream);

  buildLogger.addStream({
    type: 'raw',
    stream: transformStream,
    reemitErrorEvents: true,
    level: buildLogger.level(),
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
    // Reads the masks when the stream is created, so it includes masks added during the job.
    createLogMaskingStream: () => createTextMaskingStream(secretPatterns),
    cleanUp: async () => {
      await Promise.all([remoteLoggerStream?.cleanUp?.(), httpLogStream?.cleanUp?.()]);
    },
    outputStream: transformStream,
    logBuffer,
  };
}

export default defaultLogger;
