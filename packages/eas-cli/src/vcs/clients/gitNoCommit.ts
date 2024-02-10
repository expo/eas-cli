import spawnAsync from '@expo/spawn-async';
import chalk from 'chalk';
import path from 'path';

import GitClient from './git';
import Log from '../../log';
import { Ignore, makeShallowCopyAsync } from '../local';

export default class GitNoCommitClient extends GitClient {
  public override async isCommitRequiredAsync(): Promise<boolean> {
    return false;
  }

  public override async getRootPathAsync(): Promise<string> {
    return (await spawnAsync('git', ['rev-parse', '--show-toplevel'])).stdout.trim();
  }

  public override async makeShallowCopyAsync(
    destinationPath: string,
    options: {
      useEASIgnoreIfAvailableWhenEvaluatingFileIgnores: boolean;
    }
  ): Promise<void> {
    // normalize converts C:/some/path to C:\some\path on windows
    const srcPath = path.normalize(await this.getRootPathAsync());
    await makeShallowCopyAsync(srcPath, destinationPath, options);
  }

  public override async isFileIgnoredAsync(
    filePath: string,
    options: {
      useEASIgnoreIfAvailableWhenEvaluatingFileIgnores: boolean;
    }
  ): Promise<boolean> {
    // normalize converts C:/some/path to C:\some\path on windows
    const rootPath = path.normalize(await this.getRootPathAsync());
    const ignore = new Ignore(rootPath, options);
    await ignore.initIgnoreAsync();
    return ignore.ignores(filePath);
  }

  public override async trackFileAsync(file: string): Promise<void> {
    try {
      await super.trackFileAsync(file);
    } catch {
      // In the no commit workflow it doesn't matter if we fail to track changes,
      // so we can ignore if this throws an exception
      Log.warn(
        `Unable to track ${chalk.bold(path.basename(file))} in Git. Proceeding without tracking.`
      );
      Log.warn(`  Reason: the command ${chalk.bold(`"git add ${file}"`)} exited with an error.`);
      Log.newLine();
    }
  }
}
