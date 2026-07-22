import { fingerprintFinding, SEVERITIES, SEVERITY_RANK } from './schema.js';
import type { CoordinatorOutput, Decision, DismissalRecord, Finding, Severity } from './schema.js';

const DECISION_LABEL: Record<Decision, string> = {
  approve: 'Approve',
  approve_with_comments: 'Approve with comments',
  request_changes: 'Request changes',
};

export function decisionLabel(decision: Decision): string {
  return DECISION_LABEL[decision];
}

/** Rubric exit code: 0 for approve / approve-with-comments, 1 for request-changes. */
export function decisionExitCode(decision: Decision): number {
  return decision === 'request_changes' ? 1 : 0;
}

export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

export function groupBySeverity(findings: Finding[]): Record<Severity, Finding[]> {
  const groups: Record<Severity, Finding[]> = { critical: [], warning: [], suggestion: [] };
  for (const finding of findings) {
    groups[finding.severity].push(finding);
  }
  return groups;
}

/** HTML marker identifying the reviewer's single PR comment (used for upsert). */
export function commentMarker(tag: string): string {
  return `<!-- ${tag} -->`;
}

function location(finding: Finding): string {
  return finding.line != null ? `${finding.file}:${finding.line}` : finding.file;
}

/**
 * GitHub comment body. The marker + embedded state enable in-place updates and
 * per-PR dismissals. Findings whose fingerprint appears in `dismissed` render in a
 * collapsed "Dismissed" section instead of the main list.
 */
export function renderMarkdown(
  review: CoordinatorOutput,
  tag: string,
  dismissed: DismissalRecord[] = []
): string {
  const dismissedByFp = new Map(dismissed.map(record => [record.fp, record]));
  const withFp = review.findings.map(finding => ({ finding, fp: fingerprintFinding(finding) }));
  const kept = withFp.filter(({ fp }) => !dismissedByFp.has(fp));
  const dropped = withFp.filter(({ fp }) => dismissedByFp.has(fp));

  const lines: string[] = [commentMarker(tag), '## 🤖 AI code review', ''];
  lines.push(`**Decision:** ${decisionLabel(review.decision)}`, '', review.summary, '');

  if (review.incomplete.length > 0) {
    lines.push(
      '> ⏱️ **Coverage note:** coverage is partial — some review passes did not',
      '> finish (timed out or failed), so issues may exist in areas not fully reviewed:',
      ...review.incomplete.map(note => `> - ${note}`),
      ''
    );
  }

  if (kept.length === 0) {
    lines.push('No findings.', '');
  } else {
    const groups = groupBySeverity(sortFindings(kept.map(entry => entry.finding)));
    for (const severity of SEVERITIES) {
      const group = groups[severity];
      if (group.length === 0) {
        continue;
      }
      lines.push(`### ${severityHeading(severity)} (${group.length})`, '');
      for (const finding of group) {
        lines.push(...renderFindingLines(finding));
      }
      lines.push('');
    }
  }

  if (dropped.length > 0) {
    lines.push('<details>', `<summary>🚫 Dismissed on this PR (${dropped.length})</summary>`, '');
    for (const { finding, fp } of dropped) {
      const record = dismissedByFp.get(fp)!;
      const who = record.by ? ` by @${record.by}` : '';
      const why = record.reason ? ` — ${record.reason}` : '';
      lines.push(`- **${finding.title}** — \`${location(finding)}\` \`id:${fp}\`${who}${why}`);
    }
    lines.push('', '_Re-add one with `/undismiss <id>`._', '</details>', '');
  }

  lines.push(
    '---',
    '_Phase 1: comment-only. This review never blocks a merge and never auto-approves._'
  );
  // Embedded, machine-readable state: fingerprints (back-compat) + the full review
  // and dismissals, so `/dismiss` can re-render this comment without re-running.
  const fingerprints = review.findings.map(fingerprintFinding);
  lines.push('', `<!-- ${tag}:fingerprints=${JSON.stringify(fingerprints)} -->`);
  lines.push(`<!-- ${tag}:state=${encodeState({ review, dismissed })} -->`);
  return lines.join('\n');
}

function renderFindingLines(finding: Finding): string[] {
  const out = [
    `- **${finding.title}** — \`${location(finding)}\` _(${finding.category})_ · \`id:${fingerprintFinding(finding)}\``,
    `  ${finding.rationale}`,
  ];
  if (finding.suggestion) {
    out.push(`  _Suggestion:_ ${finding.suggestion}`);
  }
  return out;
}

/** Parse the fingerprints embedded in a previously-posted comment body. */
export function parseEmbeddedFingerprints(body: string, tag: string): string[] {
  // Escape the (config-controlled) tag so regex metacharacters can't break the match.
  const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = body.match(new RegExp(`<!-- ${escapedTag}:fingerprints=(\\[.*?\\]) -->`));
  if (!match) {
    return [];
  }
  try {
    const parsed = JSON.parse(match[1]!);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

/** The machine-readable state embedded in the reviewer's comment. */
export interface ReviewState {
  review: CoordinatorOutput;
  dismissed: DismissalRecord[];
}

function encodeState(state: ReviewState): string {
  return Buffer.from(JSON.stringify(state), 'utf8').toString('base64');
}

/** Recover the embedded `{ review, dismissed }` state from a posted comment body. */
export function parseReviewState(body: string, tag: string): ReviewState | null {
  const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = body.match(new RegExp(`<!-- ${escapedTag}:state=([A-Za-z0-9+/=]+) -->`));
  if (!match) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(match[1]!, 'base64').toString('utf8')) as ReviewState;
    if (parsed && Array.isArray(parsed.review?.findings) && Array.isArray(parsed.dismissed)) {
      return parsed;
    }
  } catch {
    // fall through
  }
  return null;
}

function severityHeading(severity: Severity): string {
  switch (severity) {
    case 'critical':
      return '🔴 Critical';
    case 'warning':
      return '🟡 Warning';
    case 'suggestion':
      return '🔵 Suggestion';
  }
}
