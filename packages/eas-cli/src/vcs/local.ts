import fg from 'fast-glob';
import fs from 'fs/promises';
import fsExtra from 'fs-extra';
import createIgnore, { Ignore as SingleFileIgnore } from 'ignore';
import path from 'path';

import Log from '../log';

export const EASIGNORE_FILENAME = '.easignore';
const GITIGNORE_FILENAME = '.gitignore';

/**
 * Ignore wraps the 'ignore' package to support multiple .gitignore files
 * in subdirectories.
 *
 * Inconsistencies with git behavior:
 * - if parent .gitignore has ignore rule and child has exception to that rule,
 *   file will still be ignored,
 * - !dir/ patterns may incorrectly un-ignore a file with the same name,
 * - node_modules is always ignored,
 * - if .easignore exists, .gitignore files are not used.
 */
export class Ignore {
  public ignoreMapping: (readonly [string, SingleFileIgnore])[] = [];

  private constructor(private readonly rootDir: string) {}

  static async createForCopyingAsync(rootDir: string): Promise<Ignore> {
    const ignore = new Ignore(rootDir);
    await ignore.initIgnoreAsync({
      defaultIgnore: `
.git
node_modules
`,
    });
    return ignore;
  }

  /** Does not include the default .git and node_modules ignore rules. */
  static async createForCheckingAsync(rootDir: string): Promise<Ignore> {
    const ignore = new Ignore(rootDir);
    await ignore.initIgnoreAsync({
      defaultIgnore: ``,
    });
    return ignore;
  }

  public async initIgnoreAsync({ defaultIgnore }: { defaultIgnore: string }): Promise<void> {
    const easIgnorePath = path.join(this.rootDir, EASIGNORE_FILENAME);
    if (await fsExtra.pathExists(easIgnorePath)) {
      this.ignoreMapping = [
        ['', createIgnore().add(defaultIgnore)],
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
        dot: true,
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
    this.ignoreMapping = [['', createIgnore().add(defaultIgnore)], ...ignoreMapping];

    Log.debug('initializing ignore mapping with .gitignore files', {
      ignoreFilePaths,
      ignoreMapping: this.ignoreMapping,
    });
  }

  public ignores(relativePath: string): boolean {
    let ignored = false;
    for (const [prefix, ignore] of this.ignoreMapping) {
      if (!relativePath.startsWith(prefix)) continue;
      const slicedPath = relativePath.slice(prefix.length);
      const result = ignore.test(slicedPath);
      if (result.ignored) ignored = true;
      else if (result.unignored) ignored = false;
      // fs.cp omits trailing slashes from directory paths, but patterns like !dir/ need one.
      // Re-test with a slash to catch directory negations. Only unignored is applied here
      // to avoid treating a file named "build" as ignored just because "build/" is a pattern.
      if (!slicedPath.endsWith('/')) {
        const resultWithSlash = ignore.test(`${slicedPath}/`);
        if (resultWithSlash.unignored) ignored = false;
      }
    }
    return ignored;
  }
}

export async function makeShallowCopyAsync(_src: string, dst: string): Promise<void> {
  // `node:fs` on Windows adds a namespace prefix (e.g. `\\?\`) to the path provided
  // to the `filter` function in `fs.cp`. We need to ensure that we compare the right paths
  // (both with prefix), otherwise the `relativePath` ends up being wrong and causes no files
  // to be ignored.
  const src = path.toNamespacedPath(path.normalize(_src));

  Log.debug('makeShallowCopyAsync', { src, dst });
  const ignore = await Ignore.createForCopyingAsync(src);
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
