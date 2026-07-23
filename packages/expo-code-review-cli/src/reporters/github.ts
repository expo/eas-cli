import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { run } from '../core/exec.js';
import { commentMarker, parseReviewState, renderMarkdown } from '../core/render.js';
import { fingerprintFinding } from '../core/schema.js';
import type { CoordinatorOutput, DismissalRecord } from '../core/schema.js';
import type { Reporter } from './reporter.js';

export interface DismissalResult {
  dismissedCount: number;
  matched: string[];
  unmatched: string[];
}

export interface GitHubReporterOptions {
  prNumber: number;
  repo: string; // owner/repo
  commentTag: string;
  breakGlassMarker: string;
  cwd?: string;
}

const MAINTAINER_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

interface IssueComment {
  id: number;
  body?: string;
  author_association?: string;
}

/**
 * Maintains exactly one PR comment, updating it in place across re-reviews (and
 * cleaning up duplicates) so the review converges instead of churning. Runs the
 * break-glass check first. Comment-only: never calls the review-state APIs.
 */
export class GitHubReporter implements Reporter {
  private readonly marker: string;

  constructor(private readonly options: GitHubReporterOptions) {
    this.marker = commentMarker(options.commentTag);
  }

  async checkBreakGlass(): Promise<boolean> {
    const comments = await this.fetchAllComments();
    return comments.some(
      comment =>
        typeof comment.body === 'string' &&
        comment.body.includes(this.options.breakGlassMarker) &&
        MAINTAINER_ASSOCIATIONS.has(comment.author_association ?? '')
    );
  }

  async postSkipNote(): Promise<void> {
    await this.upsertComment(
      `${this.marker}\n🤖 AI review skipped via \`${this.options.breakGlassMarker}\`.`
    );
  }

  async report(review: CoordinatorOutput): Promise<void> {
    // Carry forward any per-PR dismissals recorded in the existing comment so they
    // survive re-reviews (a dismissed finding stays in the collapsed section).
    const existing = await this.findExistingComment();
    const dismissed = existing
      ? (parseReviewState(existing.body, this.options.commentTag)?.dismissed ?? [])
      : [];
    await this.upsertComment(renderMarkdown(review, this.options.commentTag, dismissed, this.linkContext()));
  }

  /** PR context for turning finding locations into diff-line links. */
  private linkContext(): { repo: string; prNumber: number } {
    return { repo: this.options.repo, prNumber: this.options.prNumber };
  }

  /**
   * Add or remove per-PR finding dismissals in the reviewer's comment and re-render
   * it in place — no re-review needed (the comment embeds the full review state).
   */
  async applyDismissal(
    add: string[],
    remove: string[],
    by?: string,
    reason?: string
  ): Promise<DismissalResult> {
    const existing = await this.findExistingComment();
    if (!existing) {
      throw new Error('No reviewer comment found on this PR yet — run a review first.');
    }
    const state = parseReviewState(existing.body, this.options.commentTag);
    if (!state) {
      throw new Error(
        'The reviewer comment has no embedded state (posted before dismissals existed); re-run a review first.'
      );
    }
    const validFps = new Set(state.review.findings.map(fingerprintFinding));
    const matched = add.filter(fp => validFps.has(fp));
    const unmatched = add.filter(fp => !validFps.has(fp));

    let dismissed: DismissalRecord[] = state.dismissed.filter(record => !remove.includes(record.fp));
    for (const fp of matched) {
      if (!dismissed.some(record => record.fp === fp)) {
        dismissed.push({ fp, by, reason });
      }
    }

    await this.patchComment(
      existing.id,
      renderMarkdown(state.review, this.options.commentTag, dismissed, this.linkContext())
    );
    return { dismissedCount: dismissed.length, matched, unmatched };
  }

  /** Newest reviewer-tagged comment (id + body), or null if none posted yet. */
  private async findExistingComment(): Promise<{ id: number; body: string } | null> {
    const marked = (await this.fetchAllComments()).filter(comment => comment.body?.includes(this.marker));
    const keep = marked[marked.length - 1];
    return keep ? { id: keep.id, body: keep.body ?? '' } : null;
  }

  // Safety cap on pagination (100/page): 30 pages = 3000 comments. Bounds a
  // pathological PR; virtually every real PR exits far earlier.
  private static readonly MAX_COMMENT_PAGES = 30;

  /**
   * Fetch ALL issue comments, paginating manually (a single page's array is valid
   * JSON; `--paginate` concatenates arrays into invalid JSON). The issue-comments
   * endpoint does NOT honor `sort`/`direction`, so results come back oldest-first
   * — we must page to the end to see the newest comments (our own prior comment or
   * a recent `/skip-review` can otherwise fall outside a single 100-comment window,
   * causing duplicate comments and missed break-glass).
   */
  private async fetchAllComments(): Promise<IssueComment[]> {
    const all: IssueComment[] = [];
    for (let page = 1; page <= GitHubReporter.MAX_COMMENT_PAGES; page++) {
      const { stdout } = await run(
        'gh',
        [
          'api',
          '-X',
          'GET',
          `repos/${this.options.repo}/issues/${this.options.prNumber}/comments`,
          '-f',
          'per_page=100',
          '-f',
          `page=${page}`,
        ],
        { cwd: this.options.cwd }
      );
      let batch: IssueComment[];
      try {
        batch = JSON.parse(stdout) as IssueComment[];
      } catch {
        break;
      }
      if (!Array.isArray(batch) || batch.length === 0) {
        break;
      }
      all.push(...batch);
      if (batch.length < 100) {
        break;
      }
    }
    return all;
  }

  /**
   * Update the reviewer's existing comment if present (deleting older duplicates),
   * otherwise create it. Comments come back oldest-first, so the LAST marked one
   * is the newest and is the keeper.
   */
  private async upsertComment(body: string): Promise<void> {
    const marked = (await this.fetchAllComments()).filter(comment =>
      comment.body?.includes(this.marker)
    );

    if (marked.length === 0) {
      await this.createComment(body);
      return;
    }

    const keep = marked[marked.length - 1]!;
    const duplicates = marked.slice(0, -1);
    await this.patchComment(keep.id, body);
    for (const duplicate of duplicates) {
      await this.deleteComment(duplicate.id);
    }
  }

  private async withBodyFile<T>(body: string, fn: (jsonPath: string) => Promise<T>): Promise<T> {
    const dir = await mkdtemp(path.join(tmpdir(), 'ecr-'));
    const jsonPath = path.join(dir, 'comment.json');
    try {
      await writeFile(jsonPath, JSON.stringify({ body }), 'utf8');
      return await fn(jsonPath);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  private async createComment(body: string): Promise<void> {
    await this.withBodyFile(body, jsonPath =>
      run(
        'gh',
        [
          'api',
          '-X',
          'POST',
          `repos/${this.options.repo}/issues/${this.options.prNumber}/comments`,
          '--input',
          jsonPath,
        ],
        { cwd: this.options.cwd }
      )
    );
  }

  private async patchComment(commentId: number, body: string): Promise<void> {
    await this.withBodyFile(body, jsonPath =>
      run(
        'gh',
        [
          'api',
          '-X',
          'PATCH',
          `repos/${this.options.repo}/issues/comments/${commentId}`,
          '--input',
          jsonPath,
        ],
        { cwd: this.options.cwd }
      )
    );
  }

  private async deleteComment(commentId: number): Promise<void> {
    await run(
      'gh',
      ['api', '-X', 'DELETE', `repos/${this.options.repo}/issues/comments/${commentId}`],
      { cwd: this.options.cwd }
    );
  }
}
