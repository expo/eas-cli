import { run } from '../core/exec.js';
import { parseUnifiedDiff } from '../core/diff.js';
import type { DiffEntry, ReviewMetadata } from '../core/schema.js';
import type { ReviewSource } from './source.js';

export interface GitHubPRSourceOptions {
  prNumber: number;
  /** owner/repo. Optional; gh infers it from the checkout when omitted. */
  repo?: string;
  cwd?: string;
}

/**
 * Pulls PR diff + metadata through the `gh` CLI, which is preinstalled and
 * authenticated on GitHub Actions runners via GH_TOKEN.
 */
export class GitHubPRSource implements ReviewSource {
  constructor(private readonly options: GitHubPRSourceOptions) {}

  private repoArgs(): string[] {
    return this.options.repo ? ['--repo', this.options.repo] : [];
  }

  async getMetadata(): Promise<ReviewMetadata> {
    const { stdout } = await run(
      'gh',
      [
        'pr',
        'view',
        String(this.options.prNumber),
        ...this.repoArgs(),
        '--json',
        'title,body,baseRefName,headRefName',
      ],
      { cwd: this.options.cwd }
    );
    const parsed = JSON.parse(stdout) as {
      title?: string;
      body?: string;
      baseRefName?: string;
      headRefName?: string;
    };
    return {
      title: parsed.title ?? '',
      body: parsed.body ?? '',
      baseRef: parsed.baseRefName ?? '',
      headRef: parsed.headRefName ?? '',
    };
  }

  async getChangedFiles(): Promise<DiffEntry[]> {
    const { stdout } = await run(
      'gh',
      ['pr', 'diff', String(this.options.prNumber), ...this.repoArgs()],
      { cwd: this.options.cwd }
    );
    return parseUnifiedDiff(stdout);
  }
}
