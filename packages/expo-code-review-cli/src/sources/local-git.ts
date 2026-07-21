import { git, run } from '../core/exec.js';
import { parseUnifiedDiff } from '../core/diff.js';
import type { DiffEntry, ReviewMetadata } from '../core/schema.js';
import type { ReviewSource } from './source.js';

export interface LocalGitOptions {
  /** Base ref to diff against. Defaults to the merge-base with the default branch. */
  base?: string;
  /** Head ref. When omitted, the working tree (including uncommitted changes) is used. */
  head?: string;
  /** Review only staged changes (index vs HEAD). Ignores base/head. */
  staged?: boolean;
  cwd?: string;
}

/**
 * Reads local git state. No network calls. Default compares the working tree
 * against the merge-base with the default branch; flags override base/head or
 * restrict to staged changes.
 */
export class LocalGitSource implements ReviewSource {
  private resolvedBase: string | null = null;

  constructor(private readonly options: LocalGitOptions = {}) {}

  private get cwd(): string | undefined {
    return this.options.cwd;
  }

  private async defaultBranch(): Promise<string> {
    try {
      const ref = (await git(['symbolic-ref', 'refs/remotes/origin/HEAD'], this.cwd)).trim();
      const short = ref.replace(/^refs\/remotes\//, '');
      if (short) {
        return short;
      }
    } catch {
      // fall through to guesses
    }
    for (const guess of ['origin/main', 'origin/master', 'main', 'master']) {
      try {
        await git(['rev-parse', '--verify', '--quiet', guess], this.cwd);
        return guess;
      } catch {
        // try next
      }
    }
    return 'main';
  }

  private async resolveBase(): Promise<string> {
    if (this.resolvedBase) {
      return this.resolvedBase;
    }
    if (this.options.base) {
      this.resolvedBase = this.options.base;
      return this.resolvedBase;
    }
    const branch = await this.defaultBranch();
    try {
      this.resolvedBase = (await git(['merge-base', branch, 'HEAD'], this.cwd)).trim();
    } catch {
      this.resolvedBase = branch;
    }
    return this.resolvedBase;
  }

  async getMetadata(): Promise<ReviewMetadata> {
    if (this.options.staged) {
      return { title: '', body: '', baseRef: 'HEAD', headRef: 'STAGED' };
    }
    const base = await this.resolveBase();
    return {
      title: '',
      body: '',
      baseRef: base,
      headRef: this.options.head ?? 'WORKING_TREE',
    };
  }

  async getChangedFiles(): Promise<DiffEntry[]> {
    let raw: string;
    if (this.options.staged) {
      raw = await git(['diff', '--staged'], this.cwd);
    } else {
      const base = await this.resolveBase();
      if (this.options.head) {
        raw = await git(['diff', `${base}...${this.options.head}`], this.cwd);
      } else {
        const tracked = await git(['diff', base], this.cwd);
        const untracked = await this.untrackedDiffs();
        raw = [tracked, untracked].filter(chunk => chunk.trim()).join('\n');
      }
    }
    return parseUnifiedDiff(raw);
  }

  /**
   * Synthesize add-diffs for untracked files without mutating the index. Uses
   * `git diff --no-index` (which exits 1 when files differ, hence check: false).
   */
  private async untrackedDiffs(): Promise<string> {
    // -z: null-terminated output so filenames containing newlines parse correctly.
    const listing = await git(['ls-files', '-z', '--others', '--exclude-standard'], this.cwd);
    const files = listing.split('\0').filter(Boolean);

    const chunks: string[] = [];
    for (const file of files) {
      const { stdout } = await run('git', ['diff', '--no-index', '/dev/null', file], {
        cwd: this.cwd,
        check: false,
      });
      if (stdout.trim()) {
        chunks.push(stdout);
      }
    }
    return chunks.join('\n');
  }
}
