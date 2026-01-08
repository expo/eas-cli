import { IOType } from 'child_process';

import { pipeSpawnOutput, bunyan, PipeMode } from '@expo/logger';
import spawnAsyncOriginal, {
  SpawnResult,
  SpawnPromise,
  SpawnOptions as SpawnOptionsOriginal,
} from '@expo/spawn-async';

// We omit 'ignoreStdio' to simplify logic -- only 'stdio' governs stdio.
// We omit 'stdio' here to add further down in a logger-based union.
type SpawnOptions = Omit<SpawnOptionsOriginal, 'stdio' | 'ignoreStdio'> & {
  lineTransformer?: (line: string) => string | null;
  mode?: PipeMode;
} & (
    | {
        // If logger is passed, we require stdio to be pipe.
        logger: bunyan;
        stdio: 'pipe' | [IOType, 'pipe', 'pipe', ...IOType[]];
      }
    | {
        // If logger is not passed, stdio can be anything.
        // Defaults to inherit.
        logger?: never;
        stdio?: SpawnOptionsOriginal['stdio'];
      }
  );
// If

// eslint-disable-next-line async-protect/async-suffix
export function spawnAsync(
  command: string,
  args: string[],
  allOptions: SpawnOptions = {
    stdio: 'inherit',
    cwd: process.cwd(),
  }
): SpawnPromise<SpawnResult> {
  const { logger, ...options } = allOptions;
  const promise = spawnAsyncOriginal(command, args, options);
  if (logger && promise.child) {
    pipeSpawnOutput(logger, promise.child, options);
  }
  return promise;
}
