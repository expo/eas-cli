import { Ignore, getRootPath, makeShallowCopyAsync } from '../local.js';
import { Client } from '../vcs.js';

export default class NoVcsClient extends Client {
  public async getRootPathAsync(): Promise<string> {
    return getRootPath();
  }

  public async makeShallowCopyAsync(destinationPath: string): Promise<void> {
    const srcPath = getRootPath();
    await makeShallowCopyAsync(srcPath, destinationPath);
  }

  public async isFileIgnoredAsync(filePath: string): Promise<boolean> {
    const ignore = new Ignore(getRootPath());
    await ignore.initIgnoreAsync();
    return ignore.ignores(filePath);
  }
}
