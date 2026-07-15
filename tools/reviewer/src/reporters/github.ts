import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { run } from '../exec.ts';
import { renderMarkdown } from '../render.ts';
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
  body?: string;
  author_association?: string;
}

/**
 * Posts exactly one PR comment. Runs the break-glass check first. Phase 1 renders
 * the decision but never calls the approve / request-changes review APIs.
 */
export class GitHubReporter implements Reporter {
  private readonly skipMarker: string;

  constructor(private readonly options: GitHubReporterOptions) {
    this.skipMarker = options.skipMarker ?? '/skip-review';
  }

  async checkBreakGlass(): Promise<boolean> {
    // Request the most recent comments as a single JSON array. (Avoid
    // --paginate, which concatenates one array per page into invalid JSON.)
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
    let comments: IssueComment[];
    try {
      comments = JSON.parse(stdout) as IssueComment[];
    } catch {
      return false;
    }
    return comments.some(
      comment =>
        typeof comment.body === 'string' &&
        comment.body.includes(this.skipMarker) &&
        MAINTAINER_ASSOCIATIONS.has(comment.author_association ?? '')
    );
  }

  /** Posts a short note when a run is skipped via break-glass. */
  async postSkipNote(): Promise<void> {
    await this.postComment(
      `<!-- eas-ai-reviewer -->\n🤖 AI review skipped via \`${this.skipMarker}\`.`
    );
  }

  async report(review: CoordinatorOutput): Promise<void> {
    await this.postComment(renderMarkdown(review));
  }

  private async postComment(body: string): Promise<void> {
    // Pass the body via a temp file to avoid arg-length and quoting issues.
    const dir = await mkdtemp(path.join(tmpdir(), 'eas-review-'));
    const bodyFile = path.join(dir, 'comment.md');
    await writeFile(bodyFile, body, 'utf8');
    await run(
      'gh',
      [
        'pr',
        'comment',
        String(this.options.prNumber),
        '--repo',
        this.options.repo,
        '--body-file',
        bodyFile,
      ],
      { cwd: this.options.cwd }
    );
  }
}
