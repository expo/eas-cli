import { fingerprintFinding, SEVERITIES } from './schema.ts';
import type { CoordinatorOutput, Decision, Finding, Severity } from './schema.ts';

/** Base tag for this reviewer (general Expo tool, not eas-specific). */
export const REVIEWER_TAG = 'expo-ai-code-reviewer';
/** HTML marker identifying the reviewer's single PR comment (used for upsert). */
export const COMMENT_MARKER = `<!-- ${REVIEWER_TAG} -->`;
const FINGERPRINTS_PREFIX = `${REVIEWER_TAG}:fingerprints`;

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, warning: 1, suggestion: 2 };

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

function location(finding: Finding): string {
  return finding.line != null ? `${finding.file}:${finding.line}` : finding.file;
}

/** GitHub comment body. Marker enables in-place updates in a later phase. */
export function renderMarkdown(review: CoordinatorOutput): string {
  const lines: string[] = [COMMENT_MARKER, '## 🤖 AI code review', ''];
  lines.push(`**Decision:** ${decisionLabel(review.decision)}`, '', review.summary, '');

  if (review.findings.length === 0) {
    lines.push('No findings.', '');
  } else {
    const groups = groupBySeverity(sortFindings(review.findings));
    for (const severity of SEVERITIES) {
      const findings = groups[severity];
      if (findings.length === 0) {
        continue;
      }
      lines.push(`### ${severityHeading(severity)} (${findings.length})`, '');
      for (const finding of findings) {
        lines.push(`- **${finding.title}** — \`${location(finding)}\` _(${finding.category})_`);
        lines.push(`  ${finding.rationale}`);
        if (finding.suggestion) {
          lines.push(`  _Suggestion:_ ${finding.suggestion}`);
        }
      }
      lines.push('');
    }
  }

  lines.push(
    '---',
    '_Phase 1: comment-only. This review never blocks a merge and never auto-approves._'
  );
  // Hidden, machine-readable fingerprints of the current findings. A later run
  // (and feedback learning) reads these to reconcile against what was already
  // shown instead of churning the comment.
  const fingerprints = review.findings.map(fingerprintFinding);
  lines.push('', `<!-- ${FINGERPRINTS_PREFIX}=${JSON.stringify(fingerprints)} -->`);
  return lines.join('\n');
}

/** Parse the fingerprints embedded in a previously-posted comment body. */
export function parseEmbeddedFingerprints(body: string): string[] {
  const match = body.match(new RegExp(`<!-- ${FINGERPRINTS_PREFIX}=(\\[.*?\\]) -->`));
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
