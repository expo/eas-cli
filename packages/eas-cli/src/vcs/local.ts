import fs from 'fs-extra';
import ignore from 'ignore';
import path from 'path';

import { Client } from './vcs';

const DEFAULT_IGNORE = `
node_modules
`;

export default class LocalClient extends Client {
  public async getRootPathAsync(): Promise<string> {
    const rootPath = process.env.EAS_PROJECT_ROOT ?? process.cwd();
    if (!path.isAbsolute(rootPath)) {
      return path.resolve(process.cwd(), rootPath);
    }
    return rootPath;
  }

  public async makeShallowCopyAsync(destinationPath: string): Promise<void> {
    const srcPath = await this.getRootPathAsync();
    const easIgnorePath = path.join(srcPath, '.easignore');
    const gitIgnorePath = path.join(srcPath, '.gitignore');

    let ignoreFile = DEFAULT_IGNORE;
    if (await fs.pathExists(easIgnorePath)) {
      ignoreFile = await fs.readFile(easIgnorePath, 'utf8');
    } else if (await fs.pathExists(gitIgnorePath)) {
      ignoreFile = await fs.readFile(gitIgnorePath, 'utf8');
    }

    const match = ignore().add(ignoreFile);

    await fs.copy(srcPath, destinationPath, {
      filter: (srcFilePath: string) => {
        if (srcFilePath === srcPath) {
          return true;
        }
        return !match.ignores(path.relative(srcPath, srcFilePath));
      },
    });
  }
}
