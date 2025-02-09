import fg from 'fast-glob';
import fs from 'fs/promises';
import fsExtra from 'fs-extra';
import createIgnore, { Ignore as SingleFileIgnore } from 'ignore';
import path from 'path';

import Log from '../log';

export const EASIGNORE_FILENAME = '.easignore';
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
  public ignoreMapping: (readonly [string, SingleFileIgnore])[] = [];

  private constructor(private readonly rootDir: string) {}

  static async createAsync(rootDir: string): Promise<Ignore> {
    const ignore = new Ignore(rootDir);
    await ignore.initIgnoreAsync();
    return ignore;
  }

  public async initIgnoreAsync(): Promise<void> {
    const easIgnorePath = path.join(this.rootDir, EASIGNORE_FILENAME);
    if (await fsExtra.pathExists(easIgnorePath)) {
      this.ignoreMapping = [
        ['', createIgnore().add(DEFAULT_IGNORE)],
        ['', createIgnore().add(await fsExtra.readFile(easIgnorePath, 'utf-8'))],
      ];

      Log.debug('initializing ignore mapping with .easignore', {
        ignoreMapping: this.ignoreMapping,
      });
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
          createIgnore().add(await fsExtra.readFile(path.join(this.rootDir, filePath), 'utf-8')),
        ] as const;
      })
    );
    this.ignoreMapping = [['', createIgnore().add(DEFAULT_IGNORE)], ...ignoreMapping];

    Log.debug('initializing ignore mapping with .gitignore files', {
      ignoreFilePaths,
      ignoreMapping: this.ignoreMapping,
    });
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

export async function makeShallowCopyAsync(_src: string, dst: string): Promise<void> {
  // `node:fs` on Windows adds a namespace prefix (e.g. `\\?\`) to the path provided
  // to the `filter` function in `fs.cp`. We need to ensure that we compare the right paths
  // (both with prefix), otherwise the `relativePath` ends up being wrong and causes no files
  // to be ignored.
  const src = path.toNamespacedPath(path.normalize(_src));

  Log.debug('makeShallowCopyAsync', { src, dst });
  const ignore = await Ignore.createAsync(src);
  Log.debug('makeShallowCopyAsync ignoreMapping', { ignoreMapping: ignore.ignoreMapping });

  await fs.cp(src, dst, {
    recursive: true,
    // Preserve symlinks without re-resolving them to their original targets
    verbatimSymlinks: true,
    filter: (_srcFilePath: string) => {
      const srcFilePath = path.toNamespacedPath(_srcFilePath);

      if (srcFilePath === src) {
        return true;
      }
      const relativePath = path.relative(src, srcFilePath);
      const shouldCopyTheItem = !ignore.ignores(relativePath);

      Log.debug(shouldCopyTheItem ? 'copying' : 'skipping', {
        src,
        srcFilePath,
        relativePath,
      });

      return shouldCopyTheItem;
    },
  });
}
