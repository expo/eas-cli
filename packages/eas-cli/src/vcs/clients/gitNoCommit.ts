import spawnAsync from '@expo/spawn-async';
import path from 'path';

import { Ignore, makeShallowCopyAsync } from '../local';
import GitClient from './git';

export default class GitNoCommitClient extends GitClient {
  public async isCommitRequiredAsync(): Promise<boolean> {
    return false;
  }

  public async getRootPathAsync(): Promise<string> {
    return (await spawnAsync('git', ['rev-parse', '--show-toplevel'])).stdout.trim();
  }

  public async makeShallowCopyAsync(destinationPath: string): Promise<void> {
    // normalize converts C:/some/path to C:\some\path on windows
    const srcPath = path.normalize(await this.getRootPathAsync());
    await makeShallowCopyAsync(srcPath, destinationPath);
  }

  public async isFileIgnoredAsync(filePath: string): Promise<boolean> {
    // normalize converts C:/some/path to C:\some\path on windows
    const ignore = new Ignore(await this.getRootPathAsync());
    await ignore.initIgnoreAsync();
    return ignore.ignores(filePath);
  }
}
