import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { run } from '../core/exec.js';
import { commentMarker, renderMarkdown } from '../core/render.js';
import type { CoordinatorOutput } from '../core/schema.js';
import type { Reporter } from './reporter.js';

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
    const comments = await this.fetchRecentComments();
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
    await this.upsertComment(renderMarkdown(review, this.options.commentTag));
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
   * Update the reviewer's existing comment if present (deleting older duplicates),
   * otherwise create it. Comments are fetched newest-first, so the first marked
   * one is the keeper.
   */
  private async upsertComment(body: string): Promise<void> {
    const marked = (await this.fetchRecentComments()).filter(comment =>
      comment.body?.includes(this.marker)
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
    const dir = await mkdtemp(path.join(tmpdir(), 'ecr-'));
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
