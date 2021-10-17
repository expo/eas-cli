import fg from 'fast-glob';
import fs from 'fs-extra';
import createIgnore, { Ignore as SingleFileIgnore } from 'ignore';
import path from 'path';

const DEFAULT_IGNORE = `
.git
`;

export function getRootPath(): string {
  const rootPath = process.env.EAS_PROJECT_ROOT ?? process.cwd();
  if (!path.isAbsolute(rootPath)) {
    return path.resolve(process.cwd(), rootPath);
  }
  return rootPath;
}

/*Ignore wraps ignore package to support multiple gitignore files
 * in subdirectories
 *
 * Inconsistencies with git behavior:
 * - if parent gitignore have ignore rule and child have exception to that rule,
 *   file still will be ignored
 * - gitignore files in node_modules are ignored even if node_modules itself is not.
 * - if .easignore exists, all .gitignore files are not used (TODO maybe only root?)
 */
export class Ignore {
  private ignoreMapping: (readonly [string, SingleFileIgnore])[] = [];

  constructor(private rootDir: string) {}

  public async initIgnoreAsync(): Promise<void> {
    const easIgnorePath = path.join(this.rootDir, '.easignore');
    if (await fs.pathExists(easIgnorePath)) {
      this.ignoreMapping = [
        ['', createIgnore().add(DEFAULT_IGNORE)],
        ['', createIgnore().add(await fs.readFile(easIgnorePath, 'utf8'))],
      ];
      return;
    }
    const ignoreFileName = '.gitignore';
    const ignoreFilePaths = (await fg(`**/${ignoreFileName}`, { cwd: this.rootDir }))
      // ignoring node_modules when searching for gitignore files
      .filter(i => !i.startsWith(`node_modules`))
      // ensure that parent dir is before child directories
      .sort((a, b) => a.length - b.length && a.localeCompare(b));

    const ignoreMapping = await Promise.all(
      ignoreFilePaths.map(async file => {
        return [
          file.slice(0, file.length - ignoreFileName.length),
          createIgnore().add(await fs.readFile(path.join(this.rootDir, file), 'utf8')),
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
