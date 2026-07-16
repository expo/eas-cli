import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { run } from '../exec.ts';
import { COMMENT_MARKER, renderMarkdown } from '../render.ts';
import type { CoordinatorOutput } from '../schema.ts';
import type { Reporter } from './reporter.ts';

export interface GitHubReporterOptions {
  prNumber: number;
  repo: string; // owner/repo
  cwd?: string;
  /** Comment token that triggers break-glass. */
  skipMarker?: string;
}

const MAINTAINER_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

interface IssueComment {
  id: number;
  body?: string;
  author_association?: string;
}

/**
 * Maintains exactly one PR comment, updating it in place across re-reviews (and
 * cleaning up any duplicates from earlier runs) so the review converges instead
 * of churning. Runs the break-glass check first. Phase 1 renders the decision but
 * never calls the approve / request-changes review APIs.
 */
export class GitHubReporter implements Reporter {
  private readonly skipMarker: string;

  constructor(private readonly options: GitHubReporterOptions) {
    this.skipMarker = options.skipMarker ?? '/skip-review';
  }

  async checkBreakGlass(): Promise<boolean> {
    const comments = await this.fetchRecentComments();
    return comments.some(
      comment =>
        typeof comment.body === 'string' &&
        comment.body.includes(this.skipMarker) &&
        MAINTAINER_ASSOCIATIONS.has(comment.author_association ?? '')
    );
  }

  /** Posts/updates the single comment with a short break-glass note. */
  async postSkipNote(): Promise<void> {
    await this.upsertComment(`${COMMENT_MARKER}\n🤖 AI review skipped via \`${this.skipMarker}\`.`);
  }

  async report(review: CoordinatorOutput): Promise<void> {
    await this.upsertComment(renderMarkdown(review));
  }

  /** Most recent 100 issue comments as a single JSON array (no --paginate, which
   * concatenates one array per page into invalid JSON). */
  private async fetchRecentComments(): Promise<IssueComment[]> {
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
        'sort=created',
        '-f',
        'direction=desc',
      ],
      { cwd: this.options.cwd }
    );
    try {
      return JSON.parse(stdout) as IssueComment[];
    } catch {
      return [];
    }
  }

  /**
   * Update the reviewer's existing comment if present (deleting any older
   * duplicates), otherwise create it. Comments are fetched newest-first, so the
   * first marked comment is the one we keep.
   */
  private async upsertComment(body: string): Promise<void> {
    const marked = (await this.fetchRecentComments()).filter(comment =>
      comment.body?.includes(COMMENT_MARKER)
    );

    if (marked.length === 0) {
      await this.createComment(body);
      return;
    }

    const [keep, ...duplicates] = marked;
    await this.patchComment(keep!.id, body);
    for (const duplicate of duplicates) {
      await this.deleteComment(duplicate.id);
    }
  }

  private async withBodyFile<T>(body: string, fn: (jsonPath: string) => Promise<T>): Promise<T> {
    const dir = await mkdtemp(path.join(tmpdir(), 'eas-review-'));
    const jsonPath = path.join(dir, 'comment.json');
    await writeFile(jsonPath, JSON.stringify({ body }), 'utf8');
    return fn(jsonPath);
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
