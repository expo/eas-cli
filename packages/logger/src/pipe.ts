import { Readable } from 'stream';

import type bunyan from 'bunyan';

type LineLogger = (line: string) => void;
type LineTransformer = (line: string) => string | null;
interface SpawnOutput {
  stdout?: Readable | null;
  stderr?: Readable | null;
}

export interface PipeOptions {
  mode?: PipeMode;
  lineTransformer?: LineTransformer;
  infoCallbackFn?: () => void;
}

function pipe(stream: Readable, loggerFn: LineLogger, lineTransformer?: LineTransformer): void {
  const multilineLogger = createMultilineLogger(loggerFn, lineTransformer);
  stream.on('data', multilineLogger);
}

export enum PipeMode {
  /**
   * Pipe both stdout and stderr to logger
   */
  COMBINED,
  /**
   * Pipe both stdout and stderr to logger, but tag stderr as stdout
   */
  COMBINED_AS_STDOUT,
  /**
   * Pipe stderr to logger, but tag it as stdout. Do not pipe stdout
   * at all.
   */
  STDERR_ONLY_AS_STDOUT,
}

function pipeSpawnOutput(
  logger: bunyan,
  { stdout, stderr }: SpawnOutput = {},
  { mode = PipeMode.COMBINED, lineTransformer, infoCallbackFn }: PipeOptions = {}
): void {
  if (stdout && [PipeMode.COMBINED, PipeMode.COMBINED_AS_STDOUT].includes(mode)) {
    const stdoutLogger = logger.child({ source: 'stdout' });
    pipe(
      stdout,
      (line) => {
        stdoutLogger.info(line);
        infoCallbackFn?.();
      },
      lineTransformer
    );
  }
  if (stderr) {
    const stderrLogger = logger.child({
      source: [PipeMode.STDERR_ONLY_AS_STDOUT, PipeMode.COMBINED_AS_STDOUT].includes(mode)
        ? 'stdout'
        : 'stderr',
    });
    pipe(
      stderr,
      (line) => {
        stderrLogger.info(line);
        infoCallbackFn?.();
      },
      lineTransformer
    );
  }
}

function createMultilineLogger(loggerFn: LineLogger, transformer?: LineTransformer) {
  return (data: any): void => {
    if (!data) {
      return;
    }
    const lines = String(data).trim().split('\n');
    lines.forEach((line) => {
      if (transformer) {
        const transformedLine = transformer(line);
        if (transformedLine) {
          loggerFn(transformedLine);
        }
      } else {
        loggerFn(line);
      }
    });
  };
}

export { pipe, pipeSpawnOutput };
