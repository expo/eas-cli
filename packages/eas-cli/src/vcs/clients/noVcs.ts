import { Ignore, getRootPath, makeShallowCopyAsync } from '../local';
import { Client } from '../vcs';

export default class NoVcsClient extends Client {
  public async getRootPathAsync(): Promise<string> {
    return getRootPath();
  }

  public async makeShallowCopyAsync(
    destinationPath: string,
    options: {
      useEASIgnoreIfAvailableWhenEvaluatingFileIgnores: boolean;
    }
  ): Promise<void> {
    const srcPath = getRootPath();
    await makeShallowCopyAsync(srcPath, destinationPath, options);
  }

  public override async isFileIgnoredAsync(
    filePath: string,
    options: {
      useEASIgnoreIfAvailableWhenEvaluatingFileIgnores: boolean;
    }
  ): Promise<boolean> {
    const ignore = new Ignore(getRootPath(), options);
    await ignore.initIgnoreAsync();
    return ignore.ignores(filePath);
  }

  public override canGetLastCommitMessage(): boolean {
    return true;
  }
}
