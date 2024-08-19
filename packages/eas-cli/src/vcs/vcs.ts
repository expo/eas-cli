export abstract class Client {
  // makeShallowCopyAsync should copy current project (result of getRootPathAsync()) to the specified
  // destination, folder created this way will be uploaded "as is", so implementation should skip
  // anything that is not committed to the repository. Most optimal solution is to create shallow clone
  // using tooling provided by specific VCS, that respects all ignore rules
  public abstract makeShallowCopyAsync(destinationPath: string): Promise<void>;

  // Find root of the repository.
  //
  // On windows path might look different depending on implementation
  // - git based clients will return "C:/path/to/repo"
  // - non-git clients will return "C:\path\to\repo"
  public abstract getRootPathAsync(): Promise<string>;

  // (optional) ensureRepoExistsAsync should verify whether repository exists and tooling is installed
  // it's not required for minimal support, but lack of validation might cause the failure at a later stage.
  public async ensureRepoExistsAsync(): Promise<void> {}

  // (optional) checks whether commit is necessary before calling makeShallowCopyAsync
  //
  // If it's not implemented method `makeShallowCopyAsync` needs to be able to include uncommitted changes
  // when creating copy
  public async isCommitRequiredAsync(): Promise<boolean> {
    return false;
  }

  // (optional) hasUncommittedChangesAsync should check whether there are changes in local repository
  public async hasUncommittedChangesAsync(): Promise<boolean | undefined> {
    return undefined;
  }

  // (optional) commitAsync commits changes
  //
  // - Should be implemented if hasUncommittedChangesAsync is implemented
  // - If it's not implemented method `makeShallowCopyAsync` needs to be able to include uncommitted changes
  // in project copy
  public async commitAsync(_arg: {
    commitMessage: string;
    commitAllFiles?: boolean;
    nonInteractive: boolean;
  }): Promise<void> {
    // it should not be called unless hasUncommittedChangesAsync is implemented
    throw new Error('commitAsync is not implemented');
  }

  // (optional) mark file as tracked, if this method is called on file, the next call to
  // `commitAsync({ commitAllFiles: false })` should commit that file
  public async trackFileAsync(_file: string): Promise<void> {}

  // (optional) print diff of the changes that will be commited in the next call to
  // `commitAsync({ commitAllFiles: false })`
  public async showDiffAsync(): Promise<void> {}

  /** (optional) print list of changed files */
  public async showChangedFilesAsync(): Promise<void> {}

  // (optional) returns hash of the last commit
  // used for metadata - implementation can be safely skipped
  public async getCommitHashAsync(): Promise<string | undefined> {
    return undefined;
  }

  // (optional) returns name of the current branch
  // used for EAS Update - implementation can be safely skipped
  public async getBranchNameAsync(): Promise<string | null> {
    return null;
  }

  // (optional) returns message of the last commit
  // used for EAS Update - implementation can be safely skipped
  public async getLastCommitMessageAsync(): Promise<string | null> {
    return null;
  }

  // (optional) checks if the file is ignored, an implementation should ensure
  // that if file exists and `isFileIgnoredAsync` returns true, then that file
  // should not be included in the project tarball.
  //
  // @param filePath has to be a relative normalized path pointing to a file
  // located under the root of the repository
  public async isFileIgnoredAsync(_filePath: string): Promise<boolean> {
    return false;
  }

  /**
   * Whether this VCS client can get the last commit message.
   * Used for EAS Update - implementation can be false for noVcs client.
   */
  public abstract canGetLastCommitMessage(): boolean;
}
