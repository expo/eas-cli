import spawnAsync from '@expo/spawn-async';
import path from 'path';

import Log from '../../log';
import { Ignore, makeShallowCopyAsync } from '../local';
import { Client } from '../vcs';

export default class NoVcsClient extends Client {
  private readonly cwdOverride?: string;

  constructor(options: { cwdOverride?: string } = {}) {
    super();
    this.cwdOverride = options.cwdOverride;
  }

  public async getRootPathAsync(): Promise<string> {
    // Honor `EAS_PROJECT_ROOT` if it is set.
    if (process.env.EAS_PROJECT_ROOT) {
      const rootPath = process.env.EAS_PROJECT_ROOT;
      // `path.resolve()` will return `rootPath` if it is absolute
      // (which is what we want).
      return path.resolve(process.cwd(), rootPath);
    }

    // If `EAS_PROJECT_ROOT` is not set, try to get the root path from Git.
    try {
      return (
        await spawnAsync('git', ['rev-parse', '--show-toplevel'], {
          cwd: this.cwdOverride,
        })
      ).stdout.trim();
    } catch (err) {
      Log.warn(`Failed to get Git root path with \`git rev-parse --show-toplevel\`.`, err);
      Log.warn('Falling back to using current working directory as project root.');
      Log.warn(
        'You can set `EAS_PROJECT_ROOT` environment variable to let eas-cli know where your project is located.'
      );

      return process.cwd();
    }
  }

  public async makeShallowCopyAsync(destinationPath: string): Promise<void> {
    const srcPath = path.normalize(await this.getRootPathAsync());
    await makeShallowCopyAsync(srcPath, destinationPath);
  }

  public override async isFileIgnoredAsync(filePath: string): Promise<boolean> {
    const rootPath = path.normalize(await this.getRootPathAsync());
    const ignore = await Ignore.createForCheckingAsync(rootPath);
    return ignore.ignores(filePath);
  }

  public override canGetLastCommitMessage(): boolean {
    return false;
  }
}
