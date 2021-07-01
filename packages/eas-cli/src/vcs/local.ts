import fs from 'fs-extra';
import ignore, { Ignore } from 'ignore';
import path from 'path';

import { Client } from './vcs';

const DEFAULT_IGNORE = `
node_modules
`;

export default class LocalClient extends Client {
  public async getRootPathAsync(): Promise<string> {
    return getRootPath();
  }

  public async makeShallowCopyAsync(destinationPath: string): Promise<void> {
    const srcPath = getRootPath();
    const ignore = initIgnore();
    await fs.copy(srcPath, destinationPath, {
      filter: (srcFilePath: string) => {
        if (srcFilePath === srcPath) {
          return true;
        }
        return !ignore.ignores(path.relative(srcPath, srcFilePath));
      },
    });
  }

  public async isFileIgnoredAsync(filePath: string): Promise<boolean> {
    return initIgnore().ignores(filePath);
  }
}

function getRootPath(): string {
  const rootPath = process.env.EAS_PROJECT_ROOT ?? process.cwd();
  if (!path.isAbsolute(rootPath)) {
    return path.resolve(process.cwd(), rootPath);
  }
  return rootPath;
}

function initIgnore(): Ignore {
  const srcPath = getRootPath();
  const easIgnorePath = path.join(srcPath, '.easignore');
  const gitIgnorePath = path.join(srcPath, '.gitignore');

  let ignoreFile = DEFAULT_IGNORE;
  if (fs.pathExistsSync(easIgnorePath)) {
    ignoreFile = fs.readFileSync(easIgnorePath, 'utf8');
  } else if (fs.pathExistsSync(gitIgnorePath)) {
    ignoreFile = fs.readFileSync(gitIgnorePath, 'utf8');
  }

  return ignore().add(ignoreFile);
}
