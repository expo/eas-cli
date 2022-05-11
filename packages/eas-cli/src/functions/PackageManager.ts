import spawnAsync, { SpawnOptions, SpawnResult } from '@expo/spawn-async';
import { Transform } from 'stream';

import Log from '../log';

function ansiRegex({ onlyFirst = false } = {}): RegExp {
  const pattern = [
    '[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]+)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?\\u0007)',
    '(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-ntqry=><~]))',
  ].join('|');

  return new RegExp(pattern, onlyFirst ? undefined : 'g');
}

const ansi = `(?:${ansiRegex().source})*`;
const yarnPeerDependencyWarningPattern = new RegExp(
  `${ansi}warning${ansi} "[^"]+" has (?:unmet|incorrect) peer dependency "[^"]+"\\.\n`,
  'g'
);

class YarnStderrTransform extends Transform {
  _transform(
    chunk: Buffer,
    _encoding: string,
    callback: (error?: Error | null, data?: any) => void
  ): void {
    this.push(chunk.toString().replace(yarnPeerDependencyWarningPattern, ''));
    callback();
  }
}

export class YarnPackageManager {
  options: SpawnOptions;

  constructor({ cwd, silent }: { cwd: string; silent?: boolean }) {
    this.options = {
      env: {
        ...process.env,
      },
      cwd,
      ...(silent
        ? { ignoreStdio: true }
        : {
            stdio: ['inherit', 'inherit', 'pipe'],
          }),
    };
  }

  async runAsync(command: string): Promise<void> {
    await this.runPrivateAsync([command]);
  }

  // Private
  private async runPrivateAsync(args: string[]): Promise<SpawnResult> {
    if (!this.options.ignoreStdio) {
      Log.log(`> yarn ${args.join(' ')}`);
    }

    // Have spawnAsync consume stdio but we don't actually do anything with it if it's ignored
    const promise = spawnAsync('yarnpkg', args, { ...this.options, ignoreStdio: false });
    if (promise.child.stderr && !this.options.ignoreStdio) {
      promise.child.stderr.pipe(new YarnStderrTransform()).pipe(process.stderr);
    }
    return promise;
  }
}
