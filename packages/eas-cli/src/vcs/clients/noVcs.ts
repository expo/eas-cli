import { Ignore, getRootPath, makeShallowCopyAsync } from '../local';
import { Client } from '../vcs';

export default class NoVcsClient extends Client {
  public async getRootPathAsync(): Promise<string> {
    return getRootPath();
  }

  public async makeShallowCopyAsync(destinationPath: string): Promise<void> {
    const srcPath = getRootPath();
    await makeShallowCopyAsync(srcPath, destinationPath);
  }

  public override async isFileIgnoredAsync(filePath: string): Promise<boolean> {
    const ignore = new Ignore(getRootPath());
    await ignore.initIgnoreAsync();
    return ignore.ignores(filePath);
  }
}
