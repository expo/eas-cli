export abstract class Client {
  // makeShallowCopyAsync should copy current project (result of getRootPathAsync()) to the specified
  // destination, folder created this way will be uploaded "as is", so implementation should skip
  // anything that is not commited to the repository. Most optimal solution is to create shallow clone
  // using tooling provided by specific VCS, that respects all ignore rules
  public abstract makeShallowCopyAsync(destinationPath: string): Promise<void>;

  // Find root of the repository.
  public abstract getRootPathAsync(): Promise<string>;

  // (optional) ensureRepoExistsAsync should verify whether repository exists and tooling is installed
  // it's not required for minimal support, but lack of validation might cause the failure at a later stage.
  public async ensureRepoExistsAsync(): Promise<void> {}

  // (optional) hasUncommittedChangesAsync should check whether there are changes in local repository
  //
  // If it's not implemented method `makeShallowCopyAsync` needs to be able to include uncommited changes
  // when creating copy
  public async hasUncommittedChangesAsync(): Promise<boolean> {
    return false;
  }

  // (optional) commitAsync commits changes
  //
  // - Should be implemented if hasUncommittedChangesAsync is implemented
  // - If it's not implemented method `makeShallowCopyAsync` needs to be able to include uncommited changes
  // in project copy
  public async commitAsync(arg: {
    commitMessage: string;
    commitAllFiles?: boolean;
  }): Promise<void> {
    // it should not be called unless hasUncommittedChangesAsync is implemented
    throw new Error('commitAsync is not implemented');
  }

  // (optional) mark file as tracked, if this method is called on file, the next call to
  // `commitAsync({ commitAllFiles: false })` should commit that file
  public async trackFileAsync(file: string): Promise<void> {}

  // (optional) print diff of the changes that will be commited in the next call to
  // `commitAsync({ commitAllFiles: false })`
  public async showDiffAsync(): Promise<void> {}

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
  public async isFileIgnoredAsync(filePath: string): Promise<boolean> {
    return false;
  }
}
