import fg from 'fast-glob';
import fs from 'fs/promises';
import fsExtra from 'fs-extra';
import createIgnore, { Ignore as SingleFileIgnore } from 'ignore';
import path from 'path';

import Log from '../log';

export const EASIGNORE_FILENAME = '.easignore';
const GITIGNORE_FILENAME = '.gitignore';
const ALWAYS_IGNORED = `
.git
node_modules
`;

/** Decides which paths are left out of the copy of the project. */
export interface PathFilter {
  ignores(relativePath: string): boolean;
}

/**
 * Ignores an explicit list of paths, as opposed to a list of patterns. Paths are
 * relative to the copied directory and separated with forward slashes, and a
 * trailing slash marks a directory, whose whole content is ignored.
 *
 * `GitClient` builds this from the paths Git reports as ignored, so that the
 * copy matches what `git status` shows instead of a reimplementation of Git's
 * ignore rules.
 */
export class IgnoredPathsFilter implements PathFilter {
  private readonly ignoredFiles: Set<string>;
  private readonly ignoredDirectories: string[];
  private readonly alwaysIgnored = createIgnore().add(ALWAYS_IGNORED);

  constructor(ignoredPaths: string[]) {
    this.ignoredFiles = new Set(ignoredPaths.filter(entry => !entry.endsWith('/')));
    this.ignoredDirectories = ignoredPaths.filter(entry => entry.endsWith('/'));
  }

  public ignores(relativePath: string): boolean {
    const posixPath = relativePath.split(path.sep).join('/');
    if (this.alwaysIgnored.ignores(posixPath)) {
      return true;
    }
    if (this.ignoredFiles.has(posixPath)) {
      return true;
    }
    return this.ignoredDirectories.some(
      directory => posixPath === directory.slice(0, -1) || posixPath.startsWith(directory)
    );
  }
}

/**
 * Ignore wraps the 'ignore' package to support multiple .gitignore files
 * in subdirectories.
 *
 * Inconsistencies with git behavior:
 * - if parent .gitignore has ignore rule and child has exception to that rule,
 *   file will still be ignored,
 * - node_modules is always ignored,
 * - if .easignore exists, .gitignore files are not used,
 * - local exclude files ($GIT_DIR/info/exclude, core.excludesFile) are not read.
 *
 * `GitClient` only uses this for projects with an .easignore; otherwise it asks
 * Git for the ignored paths and uses `IgnoredPathsFilter`.
 */
export class Ignore implements PathFilter {
  public ignoreMapping: (readonly [string, SingleFileIgnore])[] = [];

  private constructor(private readonly rootDir: string) {}

  static async createForCopyingAsync(rootDir: string): Promise<Ignore> {
    const ignore = new Ignore(rootDir);
    await ignore.initIgnoreAsync({
      defaultIgnore: ALWAYS_IGNORED,
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
    for (const [prefix, ignore] of this.ignoreMapping) {
      if (relativePath.startsWith(prefix) && ignore.ignores(relativePath.slice(prefix.length))) {
        return true;
      }
    }
    return false;
  }
}

export async function makeShallowCopyAsync(
  _src: string,
  dst: string,
  filter?: PathFilter
): Promise<void> {
  // `node:fs` on Windows adds a namespace prefix (e.g. `\\?\`) to the path provided
  // to the `filter` function in `fs.cp`. We need to ensure that we compare the right paths
  // (both with prefix), otherwise the `relativePath` ends up being wrong and causes no files
  // to be ignored.
  const src = path.toNamespacedPath(path.normalize(_src));

  Log.debug('makeShallowCopyAsync', { src, dst });
  const ignore = filter ?? (await Ignore.createForCopyingAsync(src));
  Log.debug('makeShallowCopyAsync filter', { filter: ignore });

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
