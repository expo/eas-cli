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
    const ignore = await initIgnoreAsync();
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
    return (await initIgnoreAsync()).ignores(filePath);
  }
}

function getRootPath(): string {
  const rootPath = process.env.EAS_PROJECT_ROOT ?? process.cwd();
  if (!path.isAbsolute(rootPath)) {
    return path.resolve(process.cwd(), rootPath);
  }
  return rootPath;
}

async function initIgnoreAsync(): Promise<Ignore> {
  const srcPath = getRootPath();
  const easIgnorePath = path.join(srcPath, '.easignore');
  const gitIgnorePath = path.join(srcPath, '.gitignore');

  let ignoreFile = DEFAULT_IGNORE;
  if (await fs.pathExists(easIgnorePath)) {
    ignoreFile = await fs.readFile(easIgnorePath, 'utf8');
  } else if (await fs.pathExists(gitIgnorePath)) {
    ignoreFile = await fs.readFile(gitIgnorePath, 'utf8');
  }

  return ignore().add(ignoreFile);
}
