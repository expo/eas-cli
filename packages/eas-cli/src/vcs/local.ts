import fg from 'fast-glob';
import fs from 'fs-extra';
import createIgnore, { Ignore as SingleFileIgnore } from 'ignore';
import path from 'path';

const EASIGNORE_FILENAME = '.easignore';
const GITIGNORE_FILENAME = '.gitignore';

const DEFAULT_IGNORE = `
.git
node_modules
`;

export function getRootPath(): string {
  const rootPath = process.env.EAS_PROJECT_ROOT ?? process.cwd();
  if (!path.isAbsolute(rootPath)) {
    return path.resolve(process.cwd(), rootPath);
  }
  return rootPath;
}

/**
 * Ignore wraps the 'ignore' package to support multiple .gitignore files
 * in subdirectories.
 *
 * Inconsistencies with git behavior:
 * - if parent .gitignore has ignore rule and child has exception to that rule,
 *   file will still be ignored,
 * - node_modules is always ignored,
 * - if .easignore exists, .gitignore files are not used.
 */
export class Ignore {
  private ignoreMapping: (readonly [string, SingleFileIgnore])[] = [];

  constructor(private rootDir: string) {}

  public async initIgnoreAsync(): Promise<void> {
    const easIgnorePath = path.join(this.rootDir, EASIGNORE_FILENAME);
    if (await fs.pathExists(easIgnorePath)) {
      this.ignoreMapping = [
        ['', createIgnore().add(DEFAULT_IGNORE)],
        ['', createIgnore().add(await this.readIgnoreFileAsync(easIgnorePath))],
      ];
      return;
    }
    const ignoreFilePaths = (
      await fg(`**/${GITIGNORE_FILENAME}`, {
        cwd: this.rootDir,
        ignore: ['node_modules'],
        followSymbolicLinks: false,
      })
    )
      // ensure that parent dir is before child directories
      .sort((a, b) => a.length - b.length && a.localeCompare(b));

    const ignoreMapping = await Promise.all(
      ignoreFilePaths.map(async filePath => {
        return [
          filePath.slice(0, filePath.length - GITIGNORE_FILENAME.length),
          createIgnore().add(await this.readIgnoreFileAsync(path.join(this.rootDir, filePath))),
        ] as const;
      })
    );
    this.ignoreMapping = [['', createIgnore().add(DEFAULT_IGNORE)], ...ignoreMapping];
  }

  public ignores(relativePath: string): boolean {
    for (const [prefix, ignore] of this.ignoreMapping) {
      if (relativePath.startsWith(prefix) && ignore.ignores(relativePath.slice(prefix.length))) {
        return true;
      }
    }
    return false;
  }

  private async readIgnoreFileAsync(filePath: string): Promise<string> {
    const fileContents = await fs.readFile(filePath, 'utf-8');
    const lines = fileContents.split('\n');
    // Strip trailing '\'. This logic can be removed after fix upstream is released.
    // https://github.com/kaelzhang/node-ignore/issues/81
    return lines
      .map((line: string) => (line.slice(-1) === '\\' ? line.slice(0, -1) : line))
      .join('\n');
  }
}

export async function makeShallowCopyAsync(src: string, dst: string): Promise<void> {
  const ignore = new Ignore(src);
  await ignore.initIgnoreAsync();
  await fs.copy(src, dst, {
    filter: (srcFilePath: string) => {
      if (srcFilePath === src) {
        return true;
      }
      return !ignore.ignores(path.relative(src, srcFilePath));
    },
  });
}
