import { pipeSpawnOutput, bunyan, PipeOptions } from '@expo/logger';
import spawnAsync, {
  SpawnResult,
  SpawnPromise,
  SpawnOptions as SpawnAsyncOptions,
} from '@expo/spawn-async';

type SpawnOptions = SpawnAsyncOptions &
  PipeOptions & {
    logger?: bunyan;
  };

function spawn(
  command: string,
  args: string[],
  _options: SpawnOptions = {
    stdio: 'inherit',
    cwd: process.cwd(),
  }
): SpawnPromise<SpawnResult> {
  const { logger, ...options } = _options;
  if (logger) {
    options.stdio = 'pipe';
  }
  const promise = spawnAsync(command, args, options);
  if (logger && promise.child) {
    pipeSpawnOutput(logger, promise.child, options);
  }
  return promise;
}

export default spawn;
export { SpawnOptions, SpawnResult, SpawnPromise };
